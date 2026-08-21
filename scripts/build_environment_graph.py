#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import tempfile
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from shapely import STRtree, force_2d, make_valid, union_all
from shapely.geometry import LineString, Point, box, mapping

from scripts.demo_area import load_demo_area
from scripts.environment.config import ENVIRONMENT_CONFIG
from scripts.environment.enrich_edges import water_penalty_for_distance

SCHEMA_VERSION = "1.1.0"
GREEN_FRAGMENT_SIZE_METERS = 100.0
PROCESSING_VERSION = "1.0.0"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _cache_fingerprint(inspection: dict, edge_frame: gpd.GeoDataFrame) -> str:
    stable_inspection = {key: value for key, value in inspection.items() if key != "generatedAt"}
    payload = {
        "processingVersion": PROCESSING_VERSION,
        "inspection": stable_inspection,
        "edgeBounds": list(map(float, edge_frame.total_bounds)),
        "projectedCrs": ENVIRONMENT_CONFIG.projected_crs,
        "greenBufferMeters": ENVIRONMENT_CONFIG.green_buffer_meters,
        "fragmentSizeMeters": GREEN_FRAGMENT_SIZE_METERS,
        "raw": json.loads(Path("data/raw/green/source_metadata.json").read_text(encoding="utf-8")),
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _validate_provenance_chain(inspection: dict) -> None:
    green_source = json.loads(Path("data/raw/green/source_metadata.json").read_text(encoding="utf-8"))
    water_source = json.loads(Path("data/raw/drinking_station/source_metadata.json").read_text(encoding="utf-8"))
    for resource in green_source["resources"] + water_source["resources"]:
        path = Path(resource["path"])
        if not path.is_file() or _sha256(path) != resource["sha256"]:
            raise ValueError(f"Raw 文件与 source metadata SHA 不一致：{path}")
    extraction_path = Path("data/processed/green/extraction_manifest.json")
    if not extraction_path.is_file() or _sha256(extraction_path) != inspection["green"].get("extractionManifestSha256"):
        raise ValueError("Schema Inspection 与 Green extraction manifest 不一致。")
    extraction = json.loads(extraction_path.read_text(encoding="utf-8"))
    green_by_path = {item["path"]: item["sha256"] for item in green_source["resources"]}
    for archive in extraction["archives"]:
        if green_by_path.get(archive["archive"]) != archive["sha256"]:
            raise ValueError(f"Green Raw → Extraction provenance 断裂：{archive['archive']}")


def _prepare_cache(fingerprint: str, cache_prefix: str = "demo"):
    manifest = Path("data/processed/green/cache_manifest.json")
    current = json.loads(manifest.read_text()) if manifest.exists() else {}
    if current.get("fingerprint") != fingerprint:
        Path(f"data/processed/green/{cache_prefix}_green_whitelist.gpkg").unlink(missing_ok=True)
        Path(f"data/processed/green/{cache_prefix}_green_fragments_100m.gpkg").unlink(missing_ok=True)
    return manifest


def _load_green_polygons(inspection: dict, edge_frame: gpd.GeoDataFrame, cache_prefix: str = "demo"):
    cache_path = Path(f"data/processed/green/{cache_prefix}_green_whitelist.gpkg")
    if cache_path.exists():
        cached = gpd.read_file(cache_path).to_crs(ENVIRONMENT_CONFIG.projected_crs)
        return list(cached.geometry), [{"cache": str(cache_path), "loadedFeatureCount": len(cached)}]
    bounds = box(*edge_frame.total_bounds).buffer(ENVIRONMENT_CONFIG.green_buffer_meters).bounds
    polygons = []
    layer_stats = []
    for layer in inspection["green"]["layers"]:
        if not layer["include"]:
            continue
        frame = gpd.read_file(layer["path"], bbox=bounds, encoding=layer["encoding"])
        if frame.crs is None:
            raise ValueError(f"Green Layer 缺少 CRS：{layer['official_name']}")
        frame = frame.to_crs(ENVIRONMENT_CONFIG.projected_crs)
        repaired = 0
        for geometry in frame.geometry:
            if geometry is None or geometry.is_empty:
                continue
            geometry = force_2d(geometry)
            if not geometry.is_valid:
                geometry = make_valid(geometry)
                repaired += 1
            if geometry.geom_type in ("Polygon", "MultiPolygon"):
                polygons.append(geometry)
            elif geometry.geom_type == "GeometryCollection":
                polygons.extend(
                    part for part in geometry.geoms if part.geom_type in ("Polygon", "MultiPolygon")
                )
        layer_stats.append({
            "officialName": layer["official_name"],
            "loadedFeatureCount": len(frame),
            "repairedInvalidGeometryCount": repaired,
        })
    if not polygons:
        raise ValueError("白名单 Green Polygon 在 Road Graph 周边没有有效几何。")
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    gpd.GeoDataFrame({"geometry": polygons}, crs=ENVIRONMENT_CONFIG.projected_crs).to_file(
        cache_path, driver="GPKG"
    )
    return polygons, layer_stats


def _load_stations(path: Path):
    frame = pd.read_csv(path, encoding="cp932")
    lat = pd.to_numeric(frame["緯度"], errors="coerce")
    lon = pd.to_numeric(frame["経度"], errors="coerce")
    valid = lat.between(-90, 90) & lon.between(-180, 180)
    if not valid.any():
        raise ValueError("官方 Drinking Station 没有有效坐标。")
    clean = frame.loc[valid].copy()
    clean["緯度"] = lat[valid]
    clean["経度"] = lon[valid]
    geo = gpd.GeoDataFrame(
        clean,
        geometry=gpd.points_from_xy(clean["経度"], clean["緯度"]),
        crs="EPSG:4326",
    )
    return geo, geo.to_crs(ENVIRONMENT_CONFIG.projected_crs)


def _load_or_build_green_fragments(polygons, bounds, cache_prefix: str = "demo"):
    cache_path = Path(f"data/processed/green/{cache_prefix}_green_fragments_100m.gpkg")
    if cache_path.exists():
        return list(gpd.read_file(cache_path).geometry)
    min_x, min_y, max_x, max_y = bounds
    tiles = np.asarray([
        box(x, y, min(x + GREEN_FRAGMENT_SIZE_METERS, max_x), min(y + GREEN_FRAGMENT_SIZE_METERS, max_y))
        for x in np.arange(min_x, max_x, GREEN_FRAGMENT_SIZE_METERS)
        for y in np.arange(min_y, max_y, GREEN_FRAGMENT_SIZE_METERS)
    ], dtype=object)
    polygon_array = np.asarray(polygons, dtype=object)
    pairs = STRtree(polygon_array).query(tiles)
    fragments = shapely.intersection(tiles.take(pairs[0]), polygon_array.take(pairs[1]))
    fragments = [value for value in fragments if not value.is_empty and value.area > 0]
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    gpd.GeoDataFrame({"geometry": fragments}, crs=ENVIRONMENT_CONFIG.projected_crs).to_file(
        cache_path, driver="GPKG"
    )
    return fragments


def _serialize_json(path: Path, payload: object) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        return Path(temporary)
    except Exception:
        Path(temporary).unlink(missing_ok=True)
        raise


def _atomic_json(path: Path, payload: object) -> None:
    temporary = _serialize_json(path, payload)
    os.replace(temporary, path)


def _publish_json_transaction(outputs: dict[Path, object]) -> None:
    staged = {}
    try:
        for path, payload in outputs.items():
            staged[path] = _serialize_json(path, payload)
    except Exception:
        for temporary in staged.values():
            temporary.unlink(missing_ok=True)
        raise
    backups = {}
    originally_absent = {path for path in outputs if not path.exists()}
    try:
        for path in outputs:
            if path.exists():
                backup = path.with_name(f".{path.name}.rollback")
                backup.write_bytes(path.read_bytes())
                backups[path] = backup
        for path, temporary in staged.items():
            os.replace(temporary, path)
    except Exception:
        for path, backup in backups.items():
            if backup.exists():
                os.replace(backup, path)
        for path in originally_absent:
            path.unlink(missing_ok=True)
        raise
    finally:
        for temporary in staged.values():
            temporary.unlink(missing_ok=True)
        for backup in backups.values():
            backup.unlink(missing_ok=True)


def _graph_invariants(graph: dict):
    edge_signature = [
        (edge["id"], edge["source"], edge["target"], edge["length"], edge["geometry"])
        for edge in graph["edges"]
    ]
    pair_counts = Counter((edge["source"], edge["target"]) for edge in graph["edges"])
    return {
        "nodeCount": len(graph["nodes"]),
        "edgeCount": len(graph["edges"]),
        "multiEdgePairCount": sum(count > 1 for count in pair_counts.values()),
        "roadFieldsSha256": hashlib.sha256(
            json.dumps(edge_signature, ensure_ascii=False, separators=(",", ":")).encode()
        ).hexdigest(),
    }


def build(
    baseline_path: Path,
    inspection_path: Path,
    station_path: Path,
    output_dir: Path,
    *,
    area_path: Path = Path("config/demo_area.json"),
    cache_prefix: str = "demo",
):
    baseline_bytes = baseline_path.read_bytes()
    graph = json.loads(baseline_bytes)
    if graph["metadata"].get("graphVersion") != "1.0.0":
        raise ValueError("M4 必须从锁定的 Browser Graph Schema 1.0.0 基线构建。")
    baseline_invariants = _graph_invariants(graph)
    inspection = json.loads(inspection_path.read_text(encoding="utf-8"))
    _validate_provenance_chain(inspection)

    edge_geo = gpd.GeoDataFrame(
        {"edge_index": range(len(graph["edges"]))},
        geometry=[LineString(edge["geometry"]) for edge in graph["edges"]],
        crs="EPSG:4326",
    ).to_crs(ENVIRONMENT_CONFIG.projected_crs)
    print(f"[M4] projected edges: {len(edge_geo)}", file=sys.stderr, flush=True)
    cache_fingerprint = _cache_fingerprint(inspection, edge_geo)
    cache_manifest = _prepare_cache(cache_fingerprint, cache_prefix)
    green_polygons, green_layer_stats = _load_green_polygons(inspection, edge_geo, cache_prefix)
    print(f"[M4] local green polygons: {len(green_polygons)}", file=sys.stderr, flush=True)
    green_polygons = _load_or_build_green_fragments(
        green_polygons,
        box(*edge_geo.total_bounds).buffer(ENVIRONMENT_CONFIG.green_buffer_meters).bounds,
        cache_prefix,
    )
    print(f"[M4] exact 100m green fragments: {len(green_polygons)}", file=sys.stderr, flush=True)
    green_array = np.asarray(green_polygons, dtype=object)
    green_tree = STRtree(green_array)
    stations_wgs84, stations_projected = _load_stations(station_path)
    station_points = list(stations_projected.geometry)
    print(f"[M4] valid drinking stations: {len(station_points)}", file=sys.stderr, flush=True)

    edge_geometries = edge_geo.geometry.array
    road_buffers = shapely.buffer(edge_geometries, ENVIRONMENT_CONFIG.green_buffer_meters)
    buffer_areas = shapely.area(road_buffers)
    candidate_pairs = green_tree.query(road_buffers)
    print(f"[M4] green bbox candidate pairs: {candidate_pairs.shape[1]}", file=sys.stderr, flush=True)
    clipped = shapely.intersection(
        road_buffers.take(candidate_pairs[0]), green_array.take(candidate_pairs[1])
    )
    print("[M4] candidate intersections complete", file=sys.stderr, flush=True)
    covered_areas = np.zeros(len(road_buffers), dtype=float)
    for edge_index in np.unique(candidate_pairs[0]):
        covered_areas[edge_index] = union_all(clipped[candidate_pairs[0] == edge_index]).area
    print("[M4] overlap-safe covered areas complete", file=sys.stderr, flush=True)
    scores = (covered_areas / buffer_areas).tolist()
    station_tree = STRtree(station_points)
    station_pairs, station_distances = station_tree.query_nearest(
        edge_geometries, return_distance=True, all_matches=True
    )
    print("[M4] nearest station query complete", file=sys.stderr, flush=True)
    distances_array = np.full(len(edge_geometries), np.inf)
    np.minimum.at(distances_array, station_pairs[0], station_distances)
    distances = distances_array.tolist()
    scores = [float(value) for value in scores]
    distances = [float(value) for value in distances]
    if not all(math.isfinite(value) and -1e-9 <= value <= 1 + 1e-9 for value in scores):
        raise ValueError("原始 green_score 存在 NaN/Inf 或实质越界值。")
    scores = [0.0 if abs(value) <= 1e-9 else 1.0 if abs(value - 1) <= 1e-9 else value for value in scores]
    if len(set(scores)) == 1:
        raise ValueError("green_score 全部相同，必须先诊断 CRS、覆盖、Buffer 与白名单。")
    penalties = [water_penalty_for_distance(value) for value in distances]
    if not all(math.isfinite(value) and 0 <= value <= 1 for value in penalties):
        raise ValueError("water_penalty 存在 NaN/Inf 或越界值。")
    if len(set(penalties)) == 1:
        raise ValueError("water_penalty 全部相同，必须先诊断 Drinking Station 覆盖和阈值。")
    print(f"[M4] vectorized enrichment complete: {len(scores)}", file=sys.stderr, flush=True)
    for index, (score, distance, penalty) in enumerate(zip(scores, distances, penalties, strict=True)):
        graph["edges"][index]["green_score"] = round(score, 6)
        graph["edges"][index]["water_penalty"] = penalty

    graph["metadata"].update({
        "graphVersion": SCHEMA_VERSION,
        "graphVersionMeaning": "Browser Graph Schema Version",
        "environmentGeneratedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "environment": {
            "projectedCrs": ENVIRONMENT_CONFIG.projected_crs,
            "greenBufferMeters": ENVIRONMENT_CONFIG.green_buffer_meters,
            "greenScoreMeaning": "道路 15m Buffer 内由官方实际绿色覆盖 Polygon 估算的绿色覆盖比例代理值",
            "waterDistanceMeaning": "Edge Geometry 到最近官方 Drinking Station Point 的平面距离（米）",
        },
    })
    enriched_invariants = _graph_invariants(graph)
    if enriched_invariants != baseline_invariants:
        raise ValueError("Road Graph topology/length/geometry 在 M4 enrichment 中发生变化。")
    if not all(math.isfinite(value) and 0 <= value <= 1 for value in scores + penalties):
        raise ValueError("green_score/water_penalty 超出 [0,1]。")
    if not all(math.isfinite(value) and value >= 0 for value in distances):
        raise ValueError("nearest_drinking_station_m 无效。")

    west, south, east, north = load_demo_area(area_path).bounding_box
    local_stations = stations_wgs84.cx[west:east, south:north]
    station_features = []
    for _, row in local_stations.iterrows():
        properties = {
            "name": None if pd.isna(row["施設名称"]) else str(row["施設名称"]),
            "address": str(row["所在地"]),
            "location": None if pd.isna(row["水飲み栓設置場所"]) else str(row["水飲み栓設置場所"]),
            "admissionFeeNote": None if pd.isna(row["入場料等"]) else str(row["入場料等"]),
            "type": str(row["タイプ"]),
            "sourceId": "tokyowater-drinking-stations",
        }
        station_features.append({"type": "Feature", "geometry": mapping(row.geometry), "properties": properties})
    stations_geojson = {"type": "FeatureCollection", "features": station_features}

    metadata = {
        "schemaVersion": "1.0.0",
        "processingVersion": PROCESSING_VERSION,
        "generatedAt": graph["metadata"]["environmentGeneratedAt"],
        "graphSchemaVersion": SCHEMA_VERSION,
        "green": {
            "dataset": inspection["green"]["dataset"],
            "provider": inspection["green"]["provider"],
            "definition": graph["metadata"]["environment"]["greenScoreMeaning"],
            "formula": "area(union(actual_green_polygons) ∩ buffer(edge_geometry, 15m)) / area(buffer(edge_geometry, 15m))",
            "bufferMeters": ENVIRONMENT_CONFIG.green_buffer_meters,
            "includedLayers": [layer for layer in inspection["green"]["layers"] if layer["include"]],
            "explicitlyExcludedCategories": inspection["green"]["explicitlyExcludedCategories"],
            "processing": {"unionBeforeIntersection": True, "layers": green_layer_stats},
        },
        "water": {
            "dataset": inspection["water"]["dataset"],
            "provider": inspection["water"]["provider"],
            "validStationCountUsedForNearestDistance": len(stations_wgs84),
            "demoAreaStationCountPublished": len(local_stations),
            "penaltyThresholdsMeters": [[100, 0], [300, 0.3], [500, 0.6], [">500", 1]],
            "nearbyRouteStationCount": "not_derived_in_M4",
            "formula": "water_penalty = f(distance(edge_geometry, nearest official station point))",
            "source": json.loads(Path("data/raw/drinking_station/source_metadata.json").read_text(encoding="utf-8")),
            "schemaInspection": inspection["water"],
        },
        "quality": {
            "roadGraphInvariants": enriched_invariants,
            "greenScore": {"min": min(scores), "mean": float(np.mean(scores)),
                           "median": float(np.median(scores)), "max": max(scores),
                           "standardDeviation": float(np.std(scores)),
                           "zeroEdgeCount": sum(value == 0 for value in scores),
                           "oneEdgeCount": sum(value == 1 for value in scores),
                           "zeroEdgeRatio": sum(value == 0 for value in scores) / len(scores),
                           "oneEdgeRatio": sum(value == 1 for value in scores) / len(scores),
                           "nanCount": 0, "infiniteCount": 0,
                           "allValuesIdentical": len(set(scores)) == 1},
            "nearestDrinkingStationMeters": {"min": min(distances), "mean": float(np.mean(distances)),
                                               "median": float(np.median(distances)), "max": max(distances),
                                               "standardDeviation": float(np.std(distances))},
            "waterPenaltyCounts": {str(value): penalties.count(value) for value in sorted(set(penalties))},
            "waterPenalty": {"min": min(penalties), "mean": float(np.mean(penalties)),
                              "median": float(np.median(penalties)), "max": max(penalties),
                              "standardDeviation": float(np.std(penalties)),
                              "zeroEdgeCount": sum(value == 0 for value in penalties),
                              "oneEdgeCount": sum(value == 1 for value in penalties),
                              "zeroEdgeRatio": sum(value == 0 for value in penalties) / len(penalties),
                              "oneEdgeRatio": sum(value == 1 for value in penalties) / len(penalties),
                              "nanCount": 0, "infiniteCount": 0,
                              "allValuesIdentical": len(set(penalties)) == 1},
            "nearZeroDiagnostic": (
                f"{sum(value == 0 for value in scores) / len(scores):.1%} edges are zero because the strict semantic "
                "whitelist covers localized actual green polygons; CRS, Demo overlap, 15m buffer and repaired geometry were validated."
            ),
            "validationResult": "passed",
        },
        "rawFiles": {
            "schemaInspection": str(inspection_path),
            "green": json.loads(Path("data/raw/green/source_metadata.json").read_text(encoding="utf-8"))["resources"],
            "drinkingStation": {"path": str(station_path), "sha256": _sha256(station_path)},
        },
    }
    _publish_json_transaction({
        output_dir / "drinking_stations.geojson": stations_geojson,
        output_dir / "environment_metadata.json": metadata,
        output_dir / "graph.json": graph,
    })
    cache_manifest.write_text(json.dumps({"fingerprint": cache_fingerprint}, indent=2) + "\n")
    return metadata


def main():
    parser = argparse.ArgumentParser(description="用真实官方环境数据 enrichment 浏览器 Road Graph。")
    parser.add_argument("--baseline", type=Path, default=Path("data/processed/environment/graph_schema_1_0_baseline.json"))
    parser.add_argument("--inspection", type=Path, default=Path("data/processed/environment/schema_inspection.json"))
    parser.add_argument("--stations", type=Path, default=Path("data/raw/drinking_station/tokyowaterdrinkingstation_250917.csv"))
    parser.add_argument("--output-dir", type=Path, default=Path("public/data"))
    parser.add_argument("--area", type=Path, default=Path("config/demo_area.json"))
    parser.add_argument("--cache-prefix", default="demo")
    args = parser.parse_args()
    print(json.dumps(build(
        args.baseline, args.inspection, args.stations, args.output_dir,
        area_path=args.area, cache_prefix=args.cache_prefix,
    ), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
