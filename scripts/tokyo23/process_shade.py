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
from scripts.shade.edge_scores import calculate_edge_shade_scores, load_graph_edges
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


def _write_shard(path: Path, scores: dict[str, tuple[float, ...]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent,
        prefix=f".{path.name}.", suffix=".tmp", delete=False,
    )
    temporary = Path(handle.name)
    try:
        json.dump({edge_id: list(values) for edge_id, values in scores.items()}, handle, separators=(",", ":"))
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
    graph_edges = graph_payload.get("edges", ())
    projected_edges = {edge.id: edge for edge in load_graph_edges(graph_path, "EPSG:6677")}
    groups: dict[str, list[str]] = {}
    lonlat_edges: dict[str, list[list[float]]] = {}
    for edge in graph_edges:
        geometry = edge["geometry"]
        midpoint = geometry[len(geometry) // 2]
        mesh_id = mesh_id_for_point(float(midpoint[0]), float(midpoint[1]))
        groups.setdefault(mesh_id, []).append(edge["id"])
        lonlat_edges[edge["id"]] = geometry

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
    shard_directory = state_directory / "score_shards"
    progress = MeshProgress(
        state_directory / "progress.json",
        pipeline="tokyo23-shade",
        failure_path=state_directory / "failed_mesh_report.json",
    )

    for target_mesh, edge_ids in sorted(groups.items()):
        if progress.is_completed(target_mesh) and (shard_directory / f"{target_mesh}.json").is_file():
            continue
        source_paths: list[Path] = []
        try:
            coordinates = [point for edge_id in edge_ids for point in lonlat_edges[edge_id]]
            bounds = (
                min(point[0] for point in coordinates) - 0.006,
                min(point[1] for point in coordinates) - 0.0045,
                max(point[0] for point in coordinates) + 0.006,
                max(point[1] for point in coordinates) + 0.0045,
            )
            planned = tuple(entry for entry in entries if _intersects(entry.bounds, bounds))
            if not planned:
                raise ValueError("500m 影响范围内没有 PLATEAU Building mesh。")
            shadows = {scenario: _GeometryAccumulator() for scenario in config.scenarios}
            footprints = _GeometryAccumulator()
            quality = {"valid": 0, "invalid": 0, "lod2": 0, "lod1": 0}
            for entry in planned:
                raw_path = source.fetch_entries((entry,))[0]
                source_paths.append(raw_path)
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
                scenario: accumulator.finish().difference(footprint_union)
                for scenario, accumulator in shadows.items()
            }
            assigned_edges = tuple(projected_edges[edge_id] for edge_id in edge_ids)
            scores = calculate_edge_shade_scores(assigned_edges, shadow_unions, config.scenarios)
            if set(scores) != set(edge_ids):
                raise ValueError("Shade shard Edge coverage 不匹配。")
            _write_shard(shard_directory / f"{target_mesh}.json", scores)
            progress.complete(target_mesh, {
                "edgeCount": len(scores), "sourceMeshCount": len(planned), **quality,
            })
            for raw_path in source_paths:
                raw_path.unlink(missing_ok=True)
                raw_path.with_suffix(".metadata.json").unlink(missing_ok=True)
        except Exception as error:
            progress.fail(target_mesh, str(error))
        finally:
            gc.collect()

    missing_targets = tuple(mesh for mesh in groups if not progress.is_completed(mesh))
    if missing_targets:
        raise RuntimeError(
            f"Tokyo23 Shade 覆盖不足：{len(missing_targets)} 个目标 mesh 失败。"
        )
    scores = merge_score_shards(graph_payload, shard_directory)
    totals = {key: sum(item.get(key, 0) for item in progress.completed.values()) for key in ("valid", "invalid", "lod2", "lod1")}
    payload = build_shade_payload(
        graph_payload=graph_payload,
        source_metadata={
            "datasetId": tokyo.plateau.dataset_id,
            "dataset": f"Project PLATEAU Tokyo 23 Wards {tokyo.plateau.dataset_year}",
        },
        solar_positions=solar_positions,
        quality={
            "targetMeshCount": len(groups),
            "processingBuildingObservations": totals["valid"],
            "invalidBuildingObservations": totals["invalid"],
            "lod2BuildingObservations": totals["lod2"],
            "lod1FallbackObservations": totals["lod1"],
            "rawRetentionPolicy": "delete-after-validated-target-mesh",
        },
        scores=scores,
        generated_at=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    )
    report = validate_shade_payload(payload, graph_payload)
    publish_shade_json(payload, output_path)
    shutil.rmtree(shard_directory, ignore_errors=True)
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
