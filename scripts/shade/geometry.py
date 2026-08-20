"""PLATEAU Building 的整栋 LOD 选择与 Geometry Z Range 验证。"""

from __future__ import annotations

from dataclasses import dataclass
import math

from .citygml import ParsedBuilding, ParsedSolid, ParsedSurface


class BuildingGeometryError(ValueError):
    """建筑没有可用于正式 Shade 的完整 LOD Geometry。"""


@dataclass(frozen=True)
class SelectedSolid:
    lod: int
    surfaces: tuple[ParsedSurface, ...]
    min_z: float
    max_z: float
    ground_z: float


@dataclass(frozen=True)
class SelectedBuildingGeometry:
    building_id: str
    selected_lod: int
    solids: tuple[SelectedSolid, ...]
    min_z: float
    max_z: float
    height: float
    measured_height: float | None
    measured_height_difference: float | None
    quality_flags: tuple[str, ...]


def _ring_is_valid(ring: tuple[tuple[float, float, float], ...]) -> bool:
    return (
        len(ring) >= 4
        and ring[0] == ring[-1]
        and len(set(ring[:-1])) >= 3
        and all(math.isfinite(value) for coordinate in ring for value in coordinate)
    )


def _surface_is_valid(surface: ParsedSurface) -> bool:
    return _ring_is_valid(surface.exterior_ring) and all(
        _ring_is_valid(ring) for ring in surface.interior_rings
    )


def _z_values(solid: ParsedSolid) -> tuple[float, ...]:
    return tuple(
        coordinate[2]
        for surface in solid.surfaces
        for ring in (surface.exterior_ring, *surface.interior_rings)
        for coordinate in ring
    )


def _solid_is_complete(solid: ParsedSolid) -> bool:
    if solid.unresolved_reference_ids or len(solid.surfaces) < 4:
        return False
    if not all(_surface_is_valid(surface) for surface in solid.surfaces):
        return False
    values = _z_values(solid)
    return bool(values) and max(values) > min(values)


def _selected_solid(solid: ParsedSolid) -> SelectedSolid:
    values = _z_values(solid)
    ground_values = tuple(
        coordinate[2]
        for surface in solid.surfaces
        if surface.surface_type == "GroundSurface"
        for ring in (surface.exterior_ring, *surface.interior_rings)
        for coordinate in ring
    )
    return SelectedSolid(
        lod=solid.lod,
        surfaces=solid.surfaces,
        min_z=min(values),
        max_z=max(values),
        ground_z=min(ground_values or values),
    )


def _complete_solids(building: ParsedBuilding, lod: int) -> tuple[ParsedSolid, ...] | None:
    if building.parts:
        candidates = tuple(getattr(part, f"lod{lod}") for part in building.parts)
    else:
        candidates = (getattr(building, f"lod{lod}"),)
    return candidates if candidates and all(_solid_is_complete(solid) for solid in candidates) else None


def _valid_measured_height(value: float | None) -> float | None:
    if value is None or not math.isfinite(value) or value <= 0 or value == -9999:
        return None
    return value


def select_building_geometry(building: ParsedBuilding) -> SelectedBuildingGeometry:
    """整栋选择完整 LOD2，否则完整 LOD1；绝不混用或属性补高。"""

    selected_lod = 2
    parsed_solids = _complete_solids(building, 2)
    quality_flags: tuple[str, ...] = ()
    if parsed_solids is None:
        selected_lod = 1
        parsed_solids = _complete_solids(building, 1)
        quality_flags = ("lod1_fallback",)
    if parsed_solids is None:
        raise BuildingGeometryError(
            f"Building {building.id} 没有完整 LOD2 或完整 LOD1 Geometry。"
        )

    solids = tuple(_selected_solid(solid) for solid in parsed_solids)
    minimum_z = min(solid.min_z for solid in solids)
    maximum_z = max(solid.max_z for solid in solids)
    height = maximum_z - minimum_z
    measured_height = _valid_measured_height(building.measured_height)
    difference = height - measured_height if measured_height is not None else None
    return SelectedBuildingGeometry(
        building_id=building.id,
        selected_lod=selected_lod,
        solids=solids,
        min_z=minimum_z,
        max_z=maximum_z,
        height=height,
        measured_height=measured_height,
        measured_height_difference=difference,
        quality_flags=quality_flags,
    )
