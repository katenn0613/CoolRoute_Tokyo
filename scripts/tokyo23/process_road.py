#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gc
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
import shutil
import tempfile

import networkx as nx
import osmnx as ox
import requests
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.ops import polygonize, unary_union

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


def boundary_from_overpass_payload(payload: dict) -> Polygon | MultiPolygon:
    relations = [element for element in payload.get("elements", ()) if element.get("type") == "relation"]
    if not relations:
        raise ValueError("Overpass 没有返回行政区 Relation。")
    role_lines: dict[str, list[LineString]] = {"outer": [], "inner": []}
    for member in relations[0].get("members", ()):
        role = member.get("role")
        geometry = member.get("geometry")
        if member.get("type") != "way" or role not in role_lines or not geometry:
            continue
        coordinates = [(point["lon"], point["lat"]) for point in geometry]
        if len(coordinates) >= 2:
            role_lines[role].append(LineString(coordinates))
    outer = unary_union(tuple(polygonize(unary_union(role_lines["outer"]))))
    if outer.is_empty:
        raise ValueError("Overpass 行政区 outer ways 无法组成 Polygon。")
    if role_lines["inner"]:
        inner = unary_union(tuple(polygonize(unary_union(role_lines["inner"]))))
        if not inner.is_empty:
            outer = outer.difference(inner)
    if not isinstance(outer, (Polygon, MultiPolygon)) or outer.is_empty:
        raise ValueError("Overpass 行政区 Geometry 无效。")
    return outer


def _download_boundary_from_overpass(ward: Ward) -> Polygon | MultiPolygon:
    official_name = ward.query.split(",", 1)[0].strip()
    west, south, east, north = load_tokyo23_config().bounding_box
    query = (
        "[out:json][timeout:180];"
        f'rel["boundary"="administrative"]["admin_level"="7"]'
        f'["name"="{official_name}"]({south},{west},{north},{east});'
        "out geom;"
    )
    response = requests.post(
        f"{ox.settings.overpass_url.rstrip('/')}/interpreter",
        data={"data": query},
        timeout=ox.settings.requests_timeout,
        headers={"User-Agent": ox.settings.http_user_agent},
    )
    response.raise_for_status()
    return boundary_from_overpass_payload(response.json())


def _download_ward(ward: Ward, retries: int = 3) -> nx.MultiDiGraph:
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            try:
                boundary = _download_boundary_from_overpass(ward)
            except (requests.RequestException, ValueError):
                boundary = ox.geocode_to_gdf(ward.query).geometry.iloc[0]
            if boundary is None or boundary.is_empty or boundary.geom_type not in ("Polygon", "MultiPolygon"):
                raise ValueError(f"{ward.name} 没有可用的 OSM 行政区 Polygon。")
            return ox.graph.graph_from_polygon(
                boundary,
                network_type="walk",
                simplify=True,
                retain_all=True,
            )
        except Exception as error:
            last_error = error
            if attempt < retries:
                print(
                    f"[retry] {ward.name} 第 {attempt}/{retries} 次下载失败，5s 后重试：{error}",
                    file=sys.stderr,
                )
                time.sleep(5)
    raise ValueError(f"{ward.name} 连续 {retries} 次下载失败：{last_error}") from last_error


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
    only_ids: tuple[str, ...] | None = None,
) -> dict:
    config = load_tokyo23_config()
    osmnx_cache = Path("data/processed/tokyo23/osmnx_http_cache")
    ox.settings.cache_folder = osmnx_cache
    ox.settings.overpass_url = "https://lz4.overpass-api.de/api"
    state_dir = Path("data/processed/tokyo23/road_state")
    ward_cache_dir = state_dir / "ward_graphs"
    progress = MeshProgress(
        state_dir / "progress.json",
        pipeline="tokyo23-road",
        failure_path=state_dir / "failed_ward_report.json",
    )
    for ward in config.wards:
        if only_ids is not None and ward.id not in only_ids:
            continue
        if progress.is_completed(ward.id):
            continue
        try:
            ward_graph = _download_ward(ward)
            _save_graphml(ward_graph, ward_cache_dir / f"{ward.id}.graphml")
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
    if only_ids is None and missing:
        raise RuntimeError(
            f"Tokyo23 OSM 覆盖不足：{len(missing)} 个 Ward 未完成，详见 failed_ward_report.json。"
        )
    graph_parts = []
    if combined_cache.is_file():
        graph_parts.append(ox.io.load_graphml(combined_cache))
    graph_parts.extend(
        ox.io.load_graphml(path)
        for path in sorted(ward_cache_dir.glob("*.graphml"))
    )
    if not graph_parts:
        raise RuntimeError("Tokyo23 OSM 进度完成但缺少 Ward Graph 缓存。")
    combined = combine_ward_graphs(graph_parts)
    # 保留所有不小于阈值的弱连通分量，避免把行政区内真实步行网络当作孤岛切掉
    # （东京都心高架/地下步行道在 OSM 中可能拓扑断开）；仅丢弃极小碎屑并输出报告。
    min_component_nodes = 25
    components = sorted(nx.weakly_connected_components(combined), key=len, reverse=True)
    kept_components = [
        component for component in components if len(component) >= min_component_nodes
    ]
    dropped_sizes = sorted(
        (len(component) for component in components if len(component) < min_component_nodes),
        reverse=True,
    )
    if len(kept_components) > 1:
        print(
            f"[warn] 路网包含 {len(kept_components)} 个弱连通分量（>= {min_component_nodes} 节点），全部保留。",
            file=sys.stderr,
        )
    if dropped_sizes:
        print(
            f"[warn] 丢弃 {len(dropped_sizes)} 个极小碎屑分量（< {min_component_nodes} 节点）：{dropped_sizes[:10]}",
            file=sys.stderr,
        )
    combined = combined.subgraph(set().union(*kept_components)).copy()
    area = DemoArea(
        id=config.id, name=config.name, center=config.center,
        zoom=config.zoom, bounding_box=config.bounding_box,
    )
    payload = build_browser_graph(combined, area, datetime.now(UTC))
    statistics = validate_browser_graph(payload, area)
    write_browser_graph(payload, output)
    combined_cache.unlink(missing_ok=True)
    shutil.rmtree(ward_cache_dir, ignore_errors=True)
    shutil.rmtree(osmnx_cache, ignore_errors=True)
    return {
        "nodeCount": statistics.node_count,
        "edgeCount": statistics.edge_count,
        "averageEdgeLength": statistics.average_edge_length,
        "maximumEdgeLength": statistics.maximum_edge_length,
        "keptComponentCount": len(kept_components),
        "droppedComponentSizes": dropped_sizes,
        "output": str(output),
        "outputSizeBytes": output.stat().st_size,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="分 Ward 生成 Tokyo23 OSM 步行 Road Graph 基线。")
    parser.add_argument(
        "--output", type=Path,
        default=Path("data/processed/tokyo23/graph_schema_1_0_baseline.json"),
    )
    parser.add_argument(
        "--only", type=str, nargs="*", default=None, metavar="WARD_ID",
        help="只处理指定的 ward id（如 13106 台東区），用于单区测试；不指定则处理全部 23 区。",
    )
    args = parser.parse_args()
    only_ids = tuple(args.only) if args.only else None
    print(json.dumps(run(output=args.output, only_ids=only_ids), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
