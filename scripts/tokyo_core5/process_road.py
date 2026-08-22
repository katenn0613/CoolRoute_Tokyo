#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from datetime import UTC, datetime
from pathlib import Path
import sys
import tempfile

import networkx as nx
import osmnx as ox
from shapely.geometry import MultiPolygon, Point, Polygon, mapping
from shapely.ops import unary_union

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.demo_area import DemoArea
from scripts.osm_graph import build_browser_graph, validate_browser_graph, write_browser_graph
from scripts.tokyo_core5.config import load_core5_config


def union_ward_boundaries(boundaries: dict[str, Polygon | MultiPolygon]) -> Polygon | MultiPolygon:
    if not boundaries or any(
        geometry is None
        or geometry.is_empty
        or geometry.geom_type not in ("Polygon", "MultiPolygon")
        for geometry in boundaries.values()
    ):
        raise ValueError("Core5 任一行政区边界缺失或无效。")
    merged = unary_union(tuple(boundaries.values()))
    if merged.is_empty or merged.geom_type not in ("Polygon", "MultiPolygon"):
        raise ValueError("Core5 行政区边界无法组成有效 Union Polygon。")
    return merged


def validate_ward_coverage(
    graph: nx.MultiDiGraph,
    boundaries: dict[str, Polygon | MultiPolygon],
) -> dict[str, object]:
    if graph.number_of_nodes() == 0 or graph.number_of_edges() == 0:
        raise ValueError("Core5 Road Graph 为空。")
    ward_nodes: dict[str, tuple[object, ...]] = {}
    report: dict[str, object] = {}
    for ward_id, boundary in boundaries.items():
        nodes = tuple(
            node_id
            for node_id, attributes in graph.nodes(data=True)
            if boundary.covers(Point(float(attributes["x"]), float(attributes["y"])))
        )
        if not nodes:
            raise ValueError(f"Core5 Ward {ward_id} 没有 Road Node 覆盖。")
        node_set = set(nodes)
        edge_count = sum(
            source in node_set or target in node_set
            for source, target in graph.edges()
        )
        if edge_count == 0:
            raise ValueError(f"Core5 Ward {ward_id} 没有 Road Edge 覆盖。")
        ward_nodes[ward_id] = nodes
        report[ward_id] = {
            "nodeCount": len(nodes),
            "edgeCount": edge_count,
            "boundaryBounds": list(boundary.bounds),
        }

    components = {}
    for component_index, nodes in enumerate(nx.weakly_connected_components(graph)):
        for node_id in nodes:
            components[node_id] = component_index
    representative_components = {
        ward_id: components[nodes[0]] for ward_id, nodes in ward_nodes.items()
    }
    if len(set(representative_components.values())) != 1:
        raise ValueError("Core5 代表 Road Node 跨区不可达；拒绝发布断裂路网。")
    report["crossWardReachable"] = True
    report["weakComponentCount"] = len(set(components.values()))
    return report


def _download_boundaries(config) -> dict[str, Polygon | MultiPolygon]:
    boundaries = {}
    for ward in config.wards:
        result = ox.geocode_to_gdf(ward.query)
        if result.empty:
            raise RuntimeError(f"无法取得 {ward.name} 的 OSM 行政区边界。")
        boundaries[ward.id] = result.geometry.iloc[0]
    return boundaries


def _write_geojson(path: Path, geometry, config, coverage: dict) -> None:
    payload = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {
                "id": config.id,
                "name": config.name,
                "wardIds": [ward.id for ward in config.wards],
                "wardNames": [ward.name for ward in config.wards],
                "coverage": coverage,
            },
            "geometry": mapping(geometry),
        }],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent,
        prefix=f".{path.name}.", suffix=".tmp", delete=False,
    )
    temporary = Path(handle.name)
    try:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        handle.close()
        os.replace(temporary, path)
    except Exception:
        handle.close()
        temporary.unlink(missing_ok=True)
        raise


def run(
    output: Path = Path("data/processed/tokyo_core5/graph_schema_1_0_baseline.json"),
    service_area_output: Path = Path("public/data/service_area_tokyo_core5.geojson"),
    cache: Path = Path("data/processed/tokyo_core5/osm_core5.graphml"),
    force_download: bool = False,
) -> dict[str, object]:
    config = load_core5_config()
    boundaries = _download_boundaries(config)
    service_area = union_ward_boundaries(boundaries)
    if cache.is_file() and not force_download:
        graph = ox.io.load_graphml(cache)
        source = "cache"
    else:
        ox.settings.cache_folder = Path("data/processed/tokyo_core5/osmnx_http_cache")
        graph = ox.graph.graph_from_polygon(
            service_area,
            network_type="walk",
            simplify=True,
            retain_all=False,
        )
        cache.parent.mkdir(parents=True, exist_ok=True)
        ox.io.save_graphml(graph, cache)
        source = "OpenStreetMap"

    coverage = validate_ward_coverage(graph, boundaries)
    area = DemoArea(
        id=config.id,
        name=config.name,
        center=config.center,
        zoom=config.zoom,
        bounding_box=config.bounding_box,
    )
    payload = build_browser_graph(graph, area, datetime.now(UTC))
    statistics = validate_browser_graph(payload, area)
    write_browser_graph(payload, output)
    _write_geojson(service_area_output, service_area, config, coverage)
    return {
        "source": source,
        "nodeCount": statistics.node_count,
        "edgeCount": statistics.edge_count,
        "averageEdgeLength": statistics.average_edge_length,
        "maximumEdgeLength": statistics.maximum_edge_length,
        "wardCoverage": coverage,
        "output": str(output),
        "outputSizeBytes": output.stat().st_size,
        "serviceArea": str(service_area_output),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="以统一五区 Union 生成连通 OSM walking graph。")
    parser.add_argument("--force-download", action="store_true")
    parser.add_argument(
        "--output", type=Path,
        default=Path("data/processed/tokyo_core5/graph_schema_1_0_baseline.json"),
    )
    args = parser.parse_args()
    print(json.dumps(run(output=args.output, force_download=args.force_download), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
