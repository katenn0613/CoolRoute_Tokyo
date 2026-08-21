#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gc
import json
from datetime import UTC, datetime
from pathlib import Path
import sys
import tempfile

import networkx as nx
import osmnx as ox

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.demo_area import DemoArea
from scripts.osm_graph import build_browser_graph, validate_browser_graph, write_browser_graph
from scripts.tokyo23.config import Ward, load_tokyo23_config
from scripts.tokyo23.progress import MeshProgress


def combine_ward_graphs(graphs) -> nx.MultiDiGraph:
    graphs = tuple(graphs)
    if not graphs:
        raise ValueError("没有可合并的 Tokyo23 Ward Graph。")
    merged = nx.compose_all(graphs)
    if not isinstance(merged, nx.MultiDiGraph):
        merged = nx.MultiDiGraph(merged)
    return merged


def _download_ward(ward: Ward) -> nx.MultiDiGraph:
    boundary = ox.geocode_to_gdf(ward.query).geometry.iloc[0]
    if boundary is None or boundary.is_empty or boundary.geom_type not in ("Polygon", "MultiPolygon"):
        raise ValueError(f"{ward.name} 没有可用的 OSM 行政区 Polygon。")
    return ox.graph.graph_from_polygon(
        boundary,
        network_type="walk",
        simplify=True,
        retain_all=True,
    )


def _save_graphml(graph: nx.MultiDiGraph, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        dir=path.parent, prefix=f".{path.name}.", suffix=".graphml", delete=False,
    )
    temporary = Path(handle.name)
    handle.close()
    try:
        ox.io.save_graphml(graph, temporary)
        temporary.replace(path)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def run(
    output: Path = Path("data/processed/tokyo23/graph_schema_1_0_baseline.json"),
    combined_cache: Path = Path("data/processed/tokyo23/osm_combined.graphml"),
) -> dict:
    config = load_tokyo23_config()
    state_dir = Path("data/processed/tokyo23/road_state")
    progress = MeshProgress(
        state_dir / "progress.json",
        pipeline="tokyo23-road",
        failure_path=state_dir / "failed_ward_report.json",
    )
    combined = ox.io.load_graphml(combined_cache) if combined_cache.is_file() else None
    for ward in config.wards:
        if progress.is_completed(ward.id):
            continue
        try:
            ward_graph = _download_ward(ward)
            combined = ward_graph if combined is None else combine_ward_graphs((combined, ward_graph))
            _save_graphml(combined, combined_cache)
            progress.complete(ward.id, {
                "ward": ward.name,
                "nodeCount": ward_graph.number_of_nodes(),
                "edgeCount": ward_graph.number_of_edges(),
            })
        except Exception as error:
            progress.fail(ward.id, str(error))
        finally:
            if "ward_graph" in locals():
                del ward_graph
            gc.collect()
    missing = tuple(ward for ward in config.wards if not progress.is_completed(ward.id))
    if missing:
        raise RuntimeError(
            f"Tokyo23 OSM 覆盖不足：{len(missing)} 个 Ward 未完成，详见 failed_ward_report.json。"
        )
    if combined is None:
        if not combined_cache.is_file():
            raise RuntimeError("Tokyo23 OSM 进度完成但缺少合并缓存。")
        combined = ox.io.load_graphml(combined_cache)
    largest_nodes = max(nx.weakly_connected_components(combined), key=len)
    combined = combined.subgraph(largest_nodes).copy()
    area = DemoArea(
        id=config.id, name=config.name, center=config.center,
        zoom=config.zoom, bounding_box=config.bounding_box,
    )
    payload = build_browser_graph(combined, area, datetime.now(UTC))
    statistics = validate_browser_graph(payload, area)
    write_browser_graph(payload, output)
    combined_cache.unlink(missing_ok=True)
    return {
        "nodeCount": statistics.node_count,
        "edgeCount": statistics.edge_count,
        "averageEdgeLength": statistics.average_edge_length,
        "maximumEdgeLength": statistics.maximum_edge_length,
        "output": str(output),
        "outputSizeBytes": output.stat().st_size,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="分 Ward 生成 Tokyo23 OSM 步行 Road Graph 基线。")
    parser.add_argument(
        "--output", type=Path,
        default=Path("data/processed/tokyo23/graph_schema_1_0_baseline.json"),
    )
    args = parser.parse_args()
    print(json.dumps(run(output=args.output), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
