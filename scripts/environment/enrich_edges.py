from __future__ import annotations

import math
from collections.abc import Iterable

from shapely import union_all
from shapely.geometry.base import BaseGeometry

from scripts.environment.config import ENVIRONMENT_CONFIG


def calculate_green_score(
    edge_geometry: BaseGeometry,
    green_polygons: Iterable[BaseGeometry],
    buffer_meters: float = ENVIRONMENT_CONFIG.green_buffer_meters,
) -> float:
    """计算道路 buffer 内实际绿色覆盖 Polygon 的面积比例代理值。"""
    road_buffer = edge_geometry.buffer(buffer_meters)
    polygons = [geometry for geometry in green_polygons if geometry and not geometry.is_empty]
    if not polygons:
        return 0.0
    green_union = union_all(polygons)
    if green_union.is_empty or road_buffer.area <= 0:
        return 0.0
    ratio = road_buffer.intersection(green_union).area / road_buffer.area
    return min(1.0, max(0.0, float(ratio)))


def nearest_station_distance(
    edge_geometry: BaseGeometry,
    station_points: Iterable[BaseGeometry],
) -> float:
    points = [point for point in station_points if point and not point.is_empty]
    if not points:
        raise ValueError("Drinking Station 列表为空，禁止生成 water_penalty。")
    return float(min(edge_geometry.distance(point) for point in points))


def water_penalty_for_distance(distance_meters: float) -> float:
    if not math.isfinite(distance_meters) or distance_meters < 0:
        raise ValueError("最近 Drinking Station 距离必须是非负有限数。")
    for maximum_distance, penalty in ENVIRONMENT_CONFIG.water_penalty_thresholds:
        if distance_meters <= maximum_distance:
            return penalty
    raise AssertionError("water_penalty threshold 配置不完整。")
