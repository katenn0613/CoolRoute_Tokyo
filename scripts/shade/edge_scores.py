"""道路中心线与分场景 Shadow Polygon 的长度相交比例。"""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path

from pyproj import Transformer
from shapely import get_parts
from shapely.geometry import LineString
from shapely.geometry.base import BaseGeometry
from shapely.strtree import STRtree


@dataclass(frozen=True)
class ProjectedEdge:
    id: str
    source: str
    target: str
    geometry: LineString
    projected_length: float


def load_graph_edges(
    path: str | Path,
    analysis_crs: str,
) -> tuple[ProjectedEdge, ...]:
    """读取 production Browser Graph 并投影真实 Edge Geometry。"""

    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    transformer = Transformer.from_crs("EPSG:4326", analysis_crs, always_xy=True)
    projected: list[ProjectedEdge] = []
    seen: set[str] = set()
    for edge in payload.get("edges", ()):
        edge_id = edge.get("id")
        geometry = edge.get("geometry")
        if not isinstance(edge_id, str) or not edge_id or edge_id in seen:
            raise ValueError(f"Graph 包含缺失或重复 Edge ID：{edge_id}")
        if not isinstance(geometry, list) or len(geometry) < 2:
            raise ValueError(f"Edge {edge_id} 缺少有效 Geometry。")
        try:
            coordinates = tuple(
                transformer.transform(float(coordinate[0]), float(coordinate[1]))
                for coordinate in geometry
            )
        except (IndexError, TypeError, ValueError) as error:
            raise ValueError(f"Edge {edge_id} 包含无效经纬度。") from error
        line = LineString(coordinates)
        projected.append(
            ProjectedEdge(
                id=edge_id,
                source=str(edge.get("source", "")),
                target=str(edge.get("target", "")),
                geometry=line,
                projected_length=line.length,
            )
        )
        seen.add(edge_id)
    if not projected:
        raise ValueError("Graph 不包含任何 Edge。")
    return tuple(projected)


def calculate_edge_shade_scores(
    edges: tuple[ProjectedEdge, ...],
    shadows_by_scenario: dict[str, BaseGeometry],
    scenarios: tuple[str, ...],
) -> dict[str, tuple[float, ...]]:
    missing_scenarios = tuple(scenario for scenario in scenarios if scenario not in shadows_by_scenario)
    if missing_scenarios:
        raise ValueError(f"缺少 Shade 场景：{', '.join(missing_scenarios)}")

    scenario_indexes = {}
    for scenario in scenarios:
        shadow = shadows_by_scenario[scenario]
        parts = tuple(part for part in get_parts(shadow) if not part.is_empty)
        scenario_indexes[scenario] = (parts, STRtree(parts) if parts else None)

    scores: dict[str, tuple[float, ...]] = {}
    for edge in edges:
        if (
            not edge.id
            or edge.id in scores
            or not math.isfinite(edge.projected_length)
            or edge.projected_length <= 0
            or edge.geometry.is_empty
        ):
            raise ValueError(f"Edge {edge.id or '<missing>'} 的投影 Geometry 或长度无效。")
        scenario_scores = []
        for scenario in scenarios:
            parts, index = scenario_indexes[scenario]
            if index is None:
                shaded_length = 0.0
            else:
                candidates = index.query(edge.geometry)
                shaded_length = sum(
                    edge.geometry.intersection(parts[int(candidate)]).length
                    for candidate in candidates
                )
            ratio = shaded_length / edge.projected_length
            if not math.isfinite(ratio) or ratio < -1e-9 or ratio > 1 + 1e-9:
                raise ValueError(f"Edge {edge.id} 的 {scenario} Shade Score 无效：{ratio}")
            scenario_scores.append(min(1.0, max(0.0, ratio)))
        scores[edge.id] = tuple(scenario_scores)
    return scores
