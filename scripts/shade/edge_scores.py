"""道路中心线与分场景 Shadow Polygon 的长度相交比例。"""

from __future__ import annotations

from dataclasses import dataclass
import math

from shapely.geometry import LineString
from shapely.geometry.base import BaseGeometry


@dataclass(frozen=True)
class ProjectedEdge:
    id: str
    source: str
    target: str
    geometry: LineString
    projected_length: float


def calculate_edge_shade_scores(
    edges: tuple[ProjectedEdge, ...],
    shadows_by_scenario: dict[str, BaseGeometry],
    scenarios: tuple[str, ...],
) -> dict[str, tuple[float, ...]]:
    missing_scenarios = tuple(scenario for scenario in scenarios if scenario not in shadows_by_scenario)
    if missing_scenarios:
        raise ValueError(f"缺少 Shade 场景：{', '.join(missing_scenarios)}")

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
            shadow = shadows_by_scenario[scenario]
            shaded_length = 0.0 if shadow.is_empty else edge.geometry.intersection(shadow).length
            ratio = shaded_length / edge.projected_length
            if not math.isfinite(ratio) or ratio < -1e-9 or ratio > 1 + 1e-9:
                raise ValueError(f"Edge {edge.id} 的 {scenario} Shade Score 无效：{ratio}")
            scenario_scores.append(min(1.0, max(0.0, ratio)))
        scores[edge.id] = tuple(scenario_scores)
    return scores

