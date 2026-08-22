#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gc
import json
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
import shutil
import sys

from pyproj import Transformer
from shapely.geometry import box, shape
from shapely.ops import transform
from shapely.strtree import STRtree

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.build_shade_data import _GeometryAccumulator
from scripts.data_sources.plateau_source import PlateauEntry, PlateauSource, make_http_zip_entry_fetcher
from scripts.shade.citygml import iter_buildings
from scripts.shade.config import default_shade_config
from scripts.shade.edge_scores import load_graph_edges
from scripts.shade.geometry import BuildingGeometryError, project_building_geometry, select_building_geometry
from scripts.shade.projection import project_building_shadow
from scripts.shade.publisher import build_shade_payload, publish_shade_json, validate_shade_payload
from scripts.shade.solar import build_solar_scenarios
from scripts.tokyo23.process_shade import (
    _interval_records,
    _manifest_entries,
    _write_shard,
    merge_interval_shards,
)
from scripts.tokyo23.progress import MeshProgress
from scripts.tokyo_core5.config import load_core5_config


def _influence_geometry(geometry, meters: float):
    to_projected = Transformer.from_crs("EPSG:4326", "EPSG:6677", always_xy=True).transform
    to_wgs84 = Transformer.from_crs("EPSG:6677", "EPSG:4326", always_xy=True).transform
    return transform(to_wgs84, transform(to_projected, geometry).buffer(meters))


def select_relevant_entries(
    entries: tuple[PlateauEntry, ...],
    service_geometry,
    influence_meters: float = 500,
) -> tuple[PlateauEntry, ...]:
    geometry = box(*service_geometry) if isinstance(service_geometry, tuple) else service_geometry
    influence_area = _influence_geometry(geometry, influence_meters)
    return tuple(
        entry for entry in entries
        if influence_area.intersects(box(*entry.bounds))
    )


def entries_requiring_processing(entries, progress: MeshProgress, shard_directory: Path):
    return tuple(
        entry for entry in entries
        if not (
            progress.is_completed(entry.mesh_id)
            and (Path(shard_directory) / f"{entry.mesh_id}.json").is_file()
        )
    )


def run(
    graph_path: Path = Path("public/data/graph_tokyo_core5.json"),
    manifest_path: Path = Path("data/processed/tokyo23/plateau_manifest.json"),
    output_path: Path = Path("public/data/shade_tokyo_core5.json"),
    config_path: Path = Path("config/tokyo_core5_area.json"),
    service_area_path: Path = Path("public/data/service_area_tokyo_core5.geojson"),
) -> dict[str, object]:
    core5 = load_core5_config(config_path)
    graph_payload = json.loads(graph_path.read_text(encoding="utf-8"))
    service_payload = json.loads(service_area_path.read_text(encoding="utf-8"))
    service_geometry = shape(service_payload["features"][0]["geometry"])
    entries = select_relevant_entries(_manifest_entries(manifest_path), service_geometry, 500)
    if not entries:
        raise RuntimeError("Core5 Graph 500m 影响区内没有 PLATEAU Mesh。")

    projected_edge_tuple = load_graph_edges(graph_path, "EPSG:6677")
    projected_edges = {edge.id: edge for edge in projected_edge_tuple}
    edge_tree = STRtree(tuple(edge.geometry for edge in projected_edge_tuple))
    raw_directory = Path("data/raw/plateau_tokyo_core5")
    source = PlateauSource(
        entries=entries,
        raw_directory=raw_directory,
        entry_fetcher=make_http_zip_entry_fetcher(),
        archive_url=core5.plateau.archive_url,
    )
    config = replace(
        default_shade_config(),
        graph_path=graph_path,
        output_path=output_path,
        raw_directory=raw_directory,
        processed_directory=Path("data/processed/tokyo_core5/shade"),
    )
    solar_positions = build_solar_scenarios(config, core5.center)
    state_directory = Path("data/processed/tokyo_core5/shade_state")
    shard_directory = state_directory / "interval_shards"
    progress = MeshProgress(
        state_directory / "progress.json",
        pipeline="tokyo-core5-shade",
        failure_path=state_directory / "failed_mesh_report.json",
    )
    target_ids = {entry.mesh_id for entry in entries}
    for shard_path in shard_directory.glob("*.json"):
        if shard_path.stem not in target_ids:
            shard_path.unlink(missing_ok=True)

    for entry in entries_requiring_processing(entries, progress, shard_directory):
        raw_path: Path | None = None
        try:
            shadows = {scenario: _GeometryAccumulator() for scenario in config.scenarios}
            footprints = _GeometryAccumulator()
            quality = {"valid": 0, "invalid": 0, "lod2": 0, "lod1": 0}
            raw_path = source.fetch_entries((entry,))[0]
            for parsed in iter_buildings(raw_path):
                try:
                    building = project_building_geometry(
                        select_building_geometry(parsed),
                        parsed.source_crs or "",
                        config.analysis_crs,
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
            records = _interval_records(
                projected_edge_tuple,
                edge_tree,
                {scenario: accumulator.finish() for scenario, accumulator in shadows.items()},
                footprints.finish(),
                config.scenarios,
            )
            _write_shard(shard_directory / f"{entry.mesh_id}.json", records)
            progress.complete(entry.mesh_id, {"edgeIntersectionCount": len(records), **quality})
            if raw_path is not None:
                raw_path.unlink(missing_ok=True)
                raw_path.with_suffix(".metadata.json").unlink(missing_ok=True)
        except Exception as error:
            progress.fail(entry.mesh_id, str(error))
        finally:
            gc.collect()

    missing = tuple(
        entry.mesh_id for entry in entries
        if not progress.is_completed(entry.mesh_id)
        or not (shard_directory / f"{entry.mesh_id}.json").is_file()
    )
    if missing:
        raise RuntimeError(f"Core5 Shade 覆盖不足：{len(missing)} 个目标 Mesh 未完成。")

    scores = merge_interval_shards(projected_edges, shard_directory)
    totals = {
        key: sum(progress.completed.get(mesh_id, {}).get(key, 0) for mesh_id in target_ids)
        for key in ("valid", "invalid", "lod2", "lod1")
    }
    payload = build_shade_payload(
        graph_payload=graph_payload,
        source_metadata={
            "datasetId": core5.plateau.dataset_id,
            "dataset": f"Project PLATEAU Tokyo 23 Wards {core5.plateau.dataset_year}",
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
        "result": "passed",
        "sourceMeshCount": len(entries),
        "edgeCount": report.edge_count,
        "missingEdgeCount": len(report.missing_edge_ids),
        "unknownEdgeCount": len(report.unknown_edge_ids),
        "output": str(output_path),
        "outputSizeBytes": output_path.stat().st_size,
    }
    state_directory.mkdir(parents=True, exist_ok=True)
    (state_directory / "validation_report.json").write_text(
        json.dumps(validation, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return validation


def main() -> int:
    parser = argparse.ArgumentParser(description="增量生成东京都心5区 Building Shade Sidecar。")
    parser.add_argument("--graph", type=Path, default=Path("public/data/graph_tokyo_core5.json"))
    parser.add_argument("--manifest", type=Path, default=Path("data/processed/tokyo23/plateau_manifest.json"))
    parser.add_argument("--output", type=Path, default=Path("public/data/shade_tokyo_core5.json"))
    parser.add_argument("--config", type=Path, default=Path("config/tokyo_core5_area.json"))
    parser.add_argument("--service-area", type=Path, default=Path("public/data/service_area_tokyo_core5.geojson"))
    args = parser.parse_args()
    print(json.dumps(
        run(args.graph, args.manifest, args.output, args.config, args.service_area),
        ensure_ascii=False,
        indent=2,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
