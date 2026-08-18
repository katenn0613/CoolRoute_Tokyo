"""将真实 OSMnx MultiDiGraph 转换为浏览器 Graph Schema 1.0.0。"""

from __future__ import annotations

import json
import math
import os
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable

import networkx as nx
from pyproj import CRS

from scripts.demo_area import DemoArea


GRAPH_SCHEMA_VERSION = "1.0.0"
MIN_IN_BOUNDS_NODE_RATIO = 0.90
MAX_OUTSIDE_MARGIN_DEGREES = 0.01
ENDPOINT_TOLERANCE_SQUARED = 1e-10


class OSMGraphValidationError(ValueError):
    """真实 OSMnx 图不满足 M2 数据契约。"""


class BrowserGraphValidationError(ValueError):
    """浏览器 Graph payload 不满足 Schema 1.0.0。"""


@dataclass(frozen=True)
class GraphStatistics:
    node_count: int
    edge_count: int
    average_edge_length: float
    maximum_edge_length: float
    actual_bounding_box: tuple[float, float, float, float]
    in_bounds_node_ratio: float


def _is_finite_coordinate(lon: object, lat: object) -> bool:
    return (
        isinstance(lon, (int, float))
        and not isinstance(lon, bool)
        and isinstance(lat, (int, float))
        and not isinstance(lat, bool)
        and math.isfinite(lon)
        and math.isfinite(lat)
        and -180 <= lon <= 180
        and -90 <= lat <= 90
    )


def _distance_squared(first: list[float], second: list[float]) -> float:
    return (first[0] - second[0]) ** 2 + (first[1] - second[1]) ** 2


def _bounds_statistics(
    coordinates: Iterable[tuple[float, float]],
    demo_area: DemoArea,
    error_type: type[ValueError],
) -> tuple[tuple[float, float, float, float], float]:
    points = list(coordinates)
    west, south, east, north = demo_area.bounding_box
    longitudes = [point[0] for point in points]
    latitudes = [point[1] for point in points]
    actual_bbox = (min(longitudes), min(latitudes), max(longitudes), max(latitudes))

    far_nodes = [
        point
        for point in points
        if point[0] < west - MAX_OUTSIDE_MARGIN_DEGREES
        or point[0] > east + MAX_OUTSIDE_MARGIN_DEGREES
        or point[1] < south - MAX_OUTSIDE_MARGIN_DEGREES
        or point[1] > north + MAX_OUTSIDE_MARGIN_DEGREES
    ]
    if far_nodes:
        raise error_type(
            f"发现 {len(far_nodes)} 个明显远离 Demo Area 的异常节点；"
            f"允许的边界外容差为 {MAX_OUTSIDE_MARGIN_DEGREES} 度。"
        )

    in_bounds_count = sum(
        west <= lon <= east and south <= lat <= north for lon, lat in points
    )
    in_bounds_ratio = in_bounds_count / len(points)
    if in_bounds_ratio < MIN_IN_BOUNDS_NODE_RATIO:
        raise error_type(
            f"道路图与 Demo Area 重合不足：{in_bounds_ratio:.1%} 节点位于边界内，"
            f"最低要求为 {MIN_IN_BOUNDS_NODE_RATIO:.0%}。"
        )

    actual_center = (
        (actual_bbox[0] + actual_bbox[2]) / 2,
        (actual_bbox[1] + actual_bbox[3]) / 2,
    )
    if not (west <= actual_center[0] <= east and south <= actual_center[1] <= north):
        raise error_type("道路图主体范围中心不在 Demo Area 内。")

    return actual_bbox, in_bounds_ratio


def _statistics(
    node_coordinates: Iterable[tuple[float, float]],
    edge_lengths: Iterable[float],
    demo_area: DemoArea,
    error_type: type[ValueError],
) -> GraphStatistics:
    points = list(node_coordinates)
    lengths = list(edge_lengths)
    actual_bbox, in_bounds_ratio = _bounds_statistics(points, demo_area, error_type)
    return GraphStatistics(
        node_count=len(points),
        edge_count=len(lengths),
        average_edge_length=sum(lengths) / len(lengths),
        maximum_edge_length=max(lengths),
        actual_bounding_box=actual_bbox,
        in_bounds_node_ratio=in_bounds_ratio,
    )


def _geometry_coordinates(geometry: object) -> list[list[float]]:
    try:
        coordinates = [[float(lon), float(lat)] for lon, lat, *_ in geometry.coords]
    except (AttributeError, TypeError, ValueError) as error:
        raise OSMGraphValidationError("OSM Edge geometry 不是有效 LineString。") from error
    if len(coordinates) < 2 or any(
        not _is_finite_coordinate(lon, lat) for lon, lat in coordinates
    ):
        raise OSMGraphValidationError("OSM Edge geometry 坐标无效。")
    return coordinates


def _oriented_geometry(
    geometry: object | None,
    source_coordinate: list[float],
    target_coordinate: list[float],
) -> list[list[float]]:
    if geometry is None:
        return [source_coordinate, target_coordinate]

    coordinates = _geometry_coordinates(geometry)
    forward_distance = _distance_squared(coordinates[0], source_coordinate) + _distance_squared(
        coordinates[-1], target_coordinate
    )
    reverse_distance = _distance_squared(coordinates[-1], source_coordinate) + _distance_squared(
        coordinates[0], target_coordinate
    )
    if reverse_distance < forward_distance:
        coordinates.reverse()
    return coordinates


def validate_osm_graph(graph: nx.MultiDiGraph, demo_area: DemoArea) -> GraphStatistics:
    if not isinstance(graph, nx.MultiDiGraph) or not graph.is_directed():
        raise OSMGraphValidationError("OSM 图必须是有向 MultiDiGraph。")
    if graph.number_of_nodes() == 0 or graph.number_of_edges() == 0:
        raise OSMGraphValidationError("OSM 图的 Node 和 Edge 数量必须大于 0。")

    try:
        crs = CRS.from_user_input(graph.graph.get("crs"))
    except Exception as error:
        raise OSMGraphValidationError("OSM 图缺少有效 CRS。") from error
    if crs.to_epsg() != 4326:
        raise OSMGraphValidationError("OSM 图必须使用 EPSG:4326。")

    node_coordinates: dict[object, tuple[float, float]] = {}
    for node_id, attributes in graph.nodes(data=True):
        lon = attributes.get("x")
        lat = attributes.get("y")
        if not _is_finite_coordinate(lon, lat):
            raise OSMGraphValidationError(f"Node {node_id} 的经纬度无效。")
        node_coordinates[node_id] = (float(lon), float(lat))

    if not nx.is_weakly_connected(graph):
        raise OSMGraphValidationError("OSM 图不是弱连通图；验证停止，未修改道路图。")

    edge_lengths: list[float] = []
    for source, target, key, attributes in graph.edges(keys=True, data=True):
        if source not in node_coordinates or target not in node_coordinates:
            raise OSMGraphValidationError(
                f"Edge {source}:{target}:{key} 引用了不存在的 Node。"
            )
        length = attributes.get("length")
        if (
            not isinstance(length, (int, float))
            or isinstance(length, bool)
            or not math.isfinite(length)
            or length <= 0
        ):
            raise OSMGraphValidationError(f"Edge {source}:{target}:{key} 的 length 无效。")
        if attributes.get("geometry") is not None:
            _geometry_coordinates(attributes["geometry"])
        edge_lengths.append(float(length))

    return _statistics(
        node_coordinates.values(),
        edge_lengths,
        demo_area,
        OSMGraphValidationError,
    )


def build_browser_graph(
    graph: nx.MultiDiGraph,
    demo_area: DemoArea,
    generated_at: datetime,
) -> dict[str, object]:
    statistics = validate_osm_graph(graph, demo_area)
    nodes: dict[str, dict[str, object]] = {}
    for node_id, attributes in sorted(graph.nodes(data=True), key=lambda item: str(item[0])):
        string_id = str(node_id)
        nodes[string_id] = {
            "id": string_id,
            "lat": float(attributes["y"]),
            "lon": float(attributes["x"]),
        }

    edges: list[dict[str, object]] = []
    sorted_edges = sorted(
        graph.edges(keys=True, data=True),
        key=lambda item: (str(item[0]), str(item[1]), str(item[2])),
    )
    for source, target, key, attributes in sorted_edges:
        source_id = str(source)
        target_id = str(target)
        source_coordinate = [nodes[source_id]["lon"], nodes[source_id]["lat"]]
        target_coordinate = [nodes[target_id]["lon"], nodes[target_id]["lat"]]
        geometry = _oriented_geometry(
            attributes.get("geometry"),
            source_coordinate,
            target_coordinate,
        )
        edges.append(
            {
                "id": f"{source_id}:{target_id}:{key}",
                "source": source_id,
                "target": target_id,
                "length": float(attributes["length"]),
                "geometry": geometry,
            }
        )

    generated_at_text = generated_at.isoformat().replace("+00:00", "Z")
    payload: dict[str, object] = {
        "metadata": {
            "dataset": "OpenStreetMap",
            "provider": "OpenStreetMap contributors",
            "generatedAt": generated_at_text,
            "demoArea": demo_area.as_metadata(),
            "boundingBox": list(demo_area.bounding_box),
            "actualBoundingBox": list(statistics.actual_bounding_box),
            "nodeCount": statistics.node_count,
            "edgeCount": statistics.edge_count,
            "graphVersion": GRAPH_SCHEMA_VERSION,
            "graphVersionMeaning": "Browser Graph Schema Version",
        },
        "nodes": nodes,
        "edges": edges,
    }
    validate_browser_graph(payload, demo_area)
    return payload


def validate_browser_graph(payload: dict[str, object], demo_area: DemoArea) -> GraphStatistics:
    try:
        metadata = payload["metadata"]
        nodes = payload["nodes"]
        edges = payload["edges"]
    except (KeyError, TypeError) as error:
        raise BrowserGraphValidationError("Graph 缺少 metadata、nodes 或 edges。") from error
    if not isinstance(metadata, dict) or not isinstance(nodes, dict) or not isinstance(edges, list):
        raise BrowserGraphValidationError("Graph 顶层字段类型无效。")
    if metadata.get("graphVersion") != GRAPH_SCHEMA_VERSION:
        raise BrowserGraphValidationError("Graph Schema Version 不是 1.0.0。")
    if not nodes or not edges:
        raise BrowserGraphValidationError("Graph 的 Node 和 Edge 数量必须大于 0。")

    node_coordinates: dict[str, tuple[float, float]] = {}
    for node_id, node in nodes.items():
        if not isinstance(node, dict) or str(node.get("id")) != node_id:
            raise BrowserGraphValidationError(f"Node {node_id} 的 ID 契约无效。")
        lon = node.get("lon")
        lat = node.get("lat")
        if not _is_finite_coordinate(lon, lat):
            raise BrowserGraphValidationError(f"Node {node_id} 的经纬度无效。")
        node_coordinates[node_id] = (float(lon), float(lat))

    edge_lengths: list[float] = []
    edge_ids: set[str] = set()
    for edge in edges:
        if not isinstance(edge, dict):
            raise BrowserGraphValidationError("Edge 必须是对象。")
        edge_id = edge.get("id")
        source = edge.get("source")
        target = edge.get("target")
        if not isinstance(edge_id, str) or edge_id in edge_ids:
            raise BrowserGraphValidationError("Edge ID 缺失或重复。")
        edge_ids.add(edge_id)
        if source not in node_coordinates or target not in node_coordinates:
            raise BrowserGraphValidationError(f"Edge {edge_id} 引用了不存在的 Node。")
        length = edge.get("length")
        if (
            not isinstance(length, (int, float))
            or isinstance(length, bool)
            or not math.isfinite(length)
            or length <= 0
        ):
            raise BrowserGraphValidationError(f"Edge {edge_id} 的 length 无效。")

        geometry = edge.get("geometry")
        if (
            not isinstance(geometry, list)
            or len(geometry) < 2
            or any(
                not isinstance(point, list)
                or len(point) != 2
                or not _is_finite_coordinate(point[0], point[1])
                for point in geometry
            )
        ):
            raise BrowserGraphValidationError(f"Edge {edge_id} 的 geometry 无效。")
        source_coordinate = list(node_coordinates[source])
        target_coordinate = list(node_coordinates[target])
        if (
            _distance_squared(geometry[0], source_coordinate) > ENDPOINT_TOLERANCE_SQUARED
            or _distance_squared(geometry[-1], target_coordinate) > ENDPOINT_TOLERANCE_SQUARED
        ):
            raise BrowserGraphValidationError(f"Edge {edge_id} 的 geometry 方向或端点无效。")
        edge_lengths.append(float(length))

    if metadata.get("nodeCount") != len(nodes) or metadata.get("edgeCount") != len(edges):
        raise BrowserGraphValidationError("metadata 中的 Node/Edge 数量与内容不一致。")

    return _statistics(
        node_coordinates.values(),
        edge_lengths,
        demo_area,
        BrowserGraphValidationError,
    )


def write_browser_graph(payload: dict[str, object], output_path: Path) -> int:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_handle = tempfile.NamedTemporaryFile(
        dir=output_path.parent,
        prefix=f".{output_path.name}.",
        suffix=".tmp",
        mode="w",
        encoding="utf-8",
        delete=False,
    )
    temporary_path = Path(temporary_handle.name)
    try:
        json.dump(
            payload,
            temporary_handle,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        )
        temporary_handle.write("\n")
        temporary_handle.close()
        os.replace(temporary_path, output_path)
    except Exception:
        temporary_handle.close()
        temporary_path.unlink(missing_ok=True)
        raise
    return output_path.stat().st_size
