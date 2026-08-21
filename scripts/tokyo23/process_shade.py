#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gc
import json
import math
import os
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
import shutil
import sys
import tempfile

from shapely.geometry import Point
from shapely.strtree import STRtree

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.build_shade_data import _GeometryAccumulator
from scripts.data_sources.plateau_source import (
    PlateauEntry,
    PlateauSource,
    make_http_zip_entry_fetcher,
)
from scripts.shade.citygml import iter_buildings
from scripts.shade.config import default_shade_config
from scripts.shade.edge_scores import ProjectedEdge, load_graph_edges
from scripts.shade.geometry import BuildingGeometryError, project_building_geometry, select_building_geometry
from scripts.shade.projection import project_building_shadow
from scripts.shade.publisher import build_shade_payload, publish_shade_json, validate_shade_payload
from scripts.shade.solar import build_solar_scenarios
from scripts.tokyo23.config import load_tokyo23_config
from scripts.tokyo23.progress import MeshProgress


def mesh_id_for_point(lon: float, lat: float) -> str:
    first_lat = int(lat * 1.5)
    first_lon = int(lon) - 100
    latitude_minutes = lat * 60 - first_lat * 40
    longitude_minutes = (lon - 100 - first_lon) * 60
    second_lat = int(latitude_minutes / 5)
    second_lon = int(longitude_minutes / 7.5)
    third_lat = int((latitude_minutes - second_lat * 5) / 0.5)
    third_lon = int((longitude_minutes - second_lon * 7.5) / 0.75)
    return f"{first_lat:02d}{first_lon:02d}{second_lat}{second_lon}{third_lat}{third_lon}"


def merge_score_shards(graph_payload: dict, shard_directory: Path) -> dict[str, tuple[float, ...]]:
    graph_ids = tuple(edge.get("id") for edge in graph_payload.get("edges", ()))
    expected = set(graph_ids)
    scores: dict[str, tuple[float, ...]] = {}
    for path in sorted(Path(shard_directory).glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        for edge_id, values in payload.items():
            if edge_id in scores or edge_id not in expected:
                raise ValueError(f"Shade Edge coverage 包含重复或未知 Edge：{edge_id}")
            if (
                not isinstance(values, list)
                or len(values) != 3
                or any(not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or value > 1 for value in values)
            ):
                raise ValueError(f"Shade Edge coverage 分数无效：{edge_id}")
            scores[edge_id] = tuple(float(value) for value in values)
    missing = expected - set(scores)
    if missing or len(scores) != len(graph_ids):
        raise ValueError(f"Shade Edge coverage 不完整：missing={len(missing)}")
    return scores


def merge_intervals(intervals) -> tuple[tuple[float, float], ...]:
    ordered = sorted(
        (float(start), float(end)) if start <= end else (float(end), float(start))
        for start, end in intervals
        if not math.isclose(float(start), float(end), abs_tol=1e-9)
    )
    merged: list[list[float]] = []
    for start, end in ordered:
        if not merged or start > merged[-1][1] + 1e-9:
            merged.append([start, end])
        else:
            merged[-1][1] = max(merged[-1][1], end)
    return tuple((start, end) for start, end in merged)


def subtract_intervals(intervals, exclusions) -> tuple[tuple[float, float], ...]:
    result = []
    excluded = merge_intervals(exclusions)
    for start, end in merge_intervals(intervals):
        cursor = start
        for excluded_start, excluded_end in excluded:
            if excluded_end <= cursor:
                continue
            if excluded_start >= end:
                break
            if excluded_start > cursor:
                result.append((cursor, min(excluded_start, end)))
            cursor = max(cursor, excluded_end)
            if cursor >= end:
                break
        if cursor < end:
            result.append((cursor, end))
    return merge_intervals(result)


def _line_parts(geometry):
    if geometry.is_empty:
        return
    if geometry.geom_type in ("LineString", "LinearRing"):
        yield geometry
        return
    for part in getattr(geometry, "geoms", ()):
        yield from _line_parts(part)


def _geometry_intervals(edge: ProjectedEdge, mask) -> tuple[tuple[float, float], ...]:
    intervals = []
    for line in _line_parts(edge.geometry.intersection(mask)):
        coordinates = tuple(line.coords)
        if len(coordinates) < 2:
            continue
        start = edge.geometry.project(Point(coordinates[0]))
        end = edge.geometry.project(Point(coordinates[-1]))
        intervals.append((start, end))
    return merge_intervals(intervals)


def _interval_records(
    edges: tuple[ProjectedEdge, ...],
    edge_tree: STRtree,
    shadows_by_scenario: dict,
    footprint,
    scenarios: tuple[str, ...],
) -> dict[str, dict]:
    records: dict[str, dict] = {}
    for scenario_index, scenario in enumerate(scenarios):
        shadow = shadows_by_scenario[scenario]
        for candidate in edge_tree.query(shadow):
            edge = edges[int(candidate)]
            intervals = _geometry_intervals(edge, shadow)
            if not intervals:
                continue
            record = records.setdefault(
                edge.id, {"shadow": [[], [], []], "footprint": []}
            )
            record["shadow"][scenario_index] = [list(interval) for interval in intervals]
    for candidate in edge_tree.query(footprint):
        edge = edges[int(candidate)]
        intervals = _geometry_intervals(edge, footprint)
        if intervals:
            record = records.setdefault(
                edge.id, {"shadow": [[], [], []], "footprint": []}
            )
            record["footprint"] = [list(interval) for interval in intervals]
    return records


def merge_interval_shards(
    edges_by_id: dict[str, ProjectedEdge],
    shard_directory: Path,
) -> dict[str, tuple[float, ...]]:
    shadow_intervals = {
        edge_id: [[], [], []] for edge_id in edges_by_id
    }
    footprint_intervals = {edge_id: [] for edge_id in edges_by_id}
    for path in sorted(Path(shard_directory).glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        for edge_id, record in payload.items():
            if edge_id not in edges_by_id:
                raise ValueError(f"Shade interval shard 包含未知 Edge：{edge_id}")
            for index, values in enumerate(record.get("shadow", ())):
                shadow_intervals[edge_id][index].extend(values)
            footprint_intervals[edge_id].extend(record.get("footprint", ()))
    scores = {}
    for edge_id, edge in edges_by_id.items():
        if not math.isfinite(edge.projected_length) or edge.projected_length <= 0:
            raise ValueError(f"Edge {edge_id} 投影长度无效。")
        footprint = merge_intervals(footprint_intervals[edge_id])
        values = []
        for intervals in shadow_intervals[edge_id]:
            shaded = subtract_intervals(intervals, footprint)
            ratio = sum(end - start for start, end in shaded) / edge.projected_length
            if not math.isfinite(ratio) or ratio < -1e-9 or ratio > 1 + 1e-9:
                raise ValueError(f"Edge {edge_id} Shade interval 结果无效：{ratio}")
            values.append(min(1.0, max(0.0, ratio)))
        scores[edge_id] = tuple(values)
    return scores


def _write_shard(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent,
        prefix=f".{path.name}.", suffix=".tmp", delete=False,
    )
    temporary = Path(handle.name)
    try:
        json.dump(payload, handle, separators=(",", ":"))
        handle.close()
        json.loads(temporary.read_text(encoding="utf-8"))
        os.replace(temporary, path)
    except Exception:
        handle.close()
        temporary.unlink(missing_ok=True)
        raise


def _manifest_entries(path: Path) -> tuple[PlateauEntry, ...]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    dataset_id = str(payload["datasetId"])
    return tuple(PlateauEntry(
        mesh_id=str(item["meshId"]),
        archive_path=str(item["archivePath"]),
        bounds=tuple(float(value) for value in item["bounds"]),
        compressed_size=int(item["compressedSize"]),
        uncompressed_size=int(item["uncompressedSize"]),
        dataset_id=dataset_id,
    ) for item in payload["entries"])


def _intersects(first, second) -> bool:
    return not (
        first[2] < second[0] or second[2] < first[0]
        or first[3] < second[1] or second[3] < first[1]
    )


def run(
    graph_path: Path = Path("public/data/graph_tokyo23.json"),
    manifest_path: Path = Path("data/processed/tokyo23/plateau_manifest.json"),
    output_path: Path = Path("public/data/shade_tokyo23.json"),
) -> dict:
    tokyo = load_tokyo23_config()
    graph_payload = json.loads(graph_path.read_text(encoding="utf-8"))
    projected_edge_tuple = load_graph_edges(graph_path, "EPSG:6677")
    projected_edges = {edge.id: edge for edge in projected_edge_tuple}
    edge_tree = STRtree(tuple(edge.geometry for edge in projected_edge_tuple))

    entries = _manifest_entries(manifest_path)
    raw_directory = Path("data/raw/plateau_tokyo23")
    source = PlateauSource(
        entries=entries,
        raw_directory=raw_directory,
        entry_fetcher=make_http_zip_entry_fetcher(),
        archive_url=tokyo.plateau.archive_url,
    )
    config = replace(
        default_shade_config(),
        graph_path=graph_path,
        output_path=output_path,
        raw_directory=raw_directory,
        processed_directory=Path("data/processed/tokyo23/shade"),
    )
    solar_positions = build_solar_scenarios(config, tokyo.center)
    state_directory = Path("data/processed/tokyo23/shade_state")
    shard_directory = state_directory / "interval_shards"
    progress = MeshProgress(
        state_directory / "progress.json",
        pipeline="tokyo23-shade",
        failure_path=state_directory / "failed_mesh_report.json",
    )

    for entry in entries:
        mesh_id = entry.mesh_id
        shard_path = shard_directory / f"{mesh_id}.json"
        if progress.is_completed(mesh_id) and shard_path.is_file():
            continue
        raw_path: Path | None = None
        try:
            shadows = {scenario: _GeometryAccumulator() for scenario in config.scenarios}
            footprints = _GeometryAccumulator()
            quality = {"valid": 0, "invalid": 0, "lod2": 0, "lod1": 0}
            raw_path = source.fetch_entries((entry,))[0]
            for parsed in iter_buildings(raw_path):
                try:
                    building = project_building_geometry(
                        select_building_geometry(parsed), parsed.source_crs or "", config.analysis_crs,
                    )
                except BuildingGeometryError:
                    quality["invalid"] += 1
                    continue
                quality["valid"] += 1
                quality["lod2" if building.selected_lod == 2 else "lod1"] += 1
                for scenario, solar in solar_positions.items():
                    result = project_building_shadow(building, solar)
                    shadows[scenario].add(result.shadow)
                    if scenario == config.scenarios[0]:
                        footprints.add(result.footprint)
            footprint_union = footprints.finish()
            shadow_unions = {
                scenario: accumulator.finish()
                for scenario, accumulator in shadows.items()
            }
            records = _interval_records(
                projected_edge_tuple, edge_tree, shadow_unions, footprint_union, config.scenarios,
            )
            _write_shard(shard_path, records)
            progress.complete(mesh_id, {
                "edgeIntersectionCount": len(records), **quality,
            })
            if raw_path is not None:
                raw_path.unlink(missing_ok=True)
                raw_path.with_suffix(".metadata.json").unlink(missing_ok=True)
        except Exception as error:
            progress.fail(mesh_id, str(error))
        finally:
            gc.collect()

    missing_meshes = tuple(entry.mesh_id for entry in entries if not progress.is_completed(entry.mesh_id))
    if missing_meshes:
        raise RuntimeError(
            f"Tokyo23 Shade 覆盖不足：{len(missing_meshes)} 个 PLATEAU mesh 失败。"
        )
    scores = merge_interval_shards(projected_edges, shard_directory)
    totals = {key: sum(item.get(key, 0) for item in progress.completed.values()) for key in ("valid", "invalid", "lod2", "lod1")}
    payload = build_shade_payload(
        graph_payload=graph_payload,
        source_metadata={
            "datasetId": tokyo.plateau.dataset_id,
            "dataset": f"Project PLATEAU Tokyo 23 Wards {tokyo.plateau.dataset_year}",
        },
        solar_positions=solar_positions,
        quality={
            "sourceMeshCount": len(entries),
            "validBuildingCount": totals["valid"],
            "invalidBuildingCount": totals["invalid"],
            "lod2BuildingCount": totals["lod2"],
            "lod1FallbackCount": totals["lod1"],
            "rawRetentionPolicy": "delete-after-validated-target-mesh",
        },
        scores=scores,
        generated_at=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    )
    report = validate_shade_payload(payload, graph_payload)
    publish_shade_json(payload, output_path)
    shutil.rmtree(shard_directory, ignore_errors=True)
    shutil.rmtree(raw_directory, ignore_errors=True)
    validation = {
        "result": "passed", "edgeCount": report.edge_count,
        "missingEdgeCount": len(report.missing_edge_ids),
        "unknownEdgeCount": len(report.unknown_edge_ids),
    }
    state_directory.mkdir(parents=True, exist_ok=True)
    (state_directory / "validation_report.json").write_text(
        json.dumps(validation, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    return {**validation, "output": str(output_path), "outputSizeBytes": output_path.stat().st_size}


def main() -> int:
    parser = argparse.ArgumentParser(description="按道路 mesh 增量生成 Tokyo23 Shade Sidecar。")
    parser.add_argument("--graph", type=Path, default=Path("public/data/graph_tokyo23.json"))
    parser.add_argument("--output", type=Path, default=Path("public/data/shade_tokyo23.json"))
    args = parser.parse_args()
    print(json.dumps(run(graph_path=args.graph, output_path=args.output), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
