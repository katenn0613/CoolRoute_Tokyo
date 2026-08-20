"""将已验证的 PLATEAU 三维外壳投影为局部地面建筑阴影。"""

from __future__ import annotations

from dataclasses import dataclass
import math

from shapely import make_valid
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from .geometry import SelectedBuildingGeometry, SelectedSolid
from .solar import SolarPosition


@dataclass(frozen=True)
class ShadowProjectionResult:
    building_id: str
    shadow: BaseGeometry
    footprint: BaseGeometry


def project_vertex(
    x: float,
    y: float,
    z: float,
    ground_z: float,
    solar: SolarPosition,
) -> tuple[float, float]:
    if solar.elevation_degrees <= 0 or solar.elevation_degrees >= 90:
        raise ValueError("太阳高度角必须大于 0 且小于 90 度。")
    azimuth = math.radians(solar.azimuth_degrees)
    elevation = math.radians(solar.elevation_degrees)
    distance = (z - ground_z) / math.tan(elevation)
    return (
        x - distance * math.sin(azimuth),
        y - distance * math.cos(azimuth),
    )


def _polygonal(geometry: BaseGeometry) -> BaseGeometry:
    if geometry.is_empty:
        return Polygon()
    valid = geometry if geometry.is_valid else make_valid(geometry)
    if isinstance(valid, (Polygon, MultiPolygon)):
        return valid
    if isinstance(valid, GeometryCollection):
        polygons = [item for item in valid.geoms if isinstance(item, (Polygon, MultiPolygon))]
        return unary_union(polygons) if polygons else Polygon()
    return Polygon()


def _project_surface(surface, ground_z: float, solar: SolarPosition) -> BaseGeometry:
    exterior = tuple(project_vertex(*coordinate, ground_z, solar) for coordinate in surface.exterior_ring)
    interiors = tuple(
        tuple(project_vertex(*coordinate, ground_z, solar) for coordinate in ring)
        for ring in surface.interior_rings
    )
    return _polygonal(Polygon(exterior, interiors))


def _surface_at_ground(surface, solid: SelectedSolid) -> bool:
    values = tuple(coordinate[2] for coordinate in surface.exterior_ring)
    return bool(values) and all(math.isclose(value, solid.ground_z, abs_tol=1e-6) for value in values)


def _solid_footprint(solid: SelectedSolid) -> BaseGeometry:
    candidates = [
        surface
        for surface in solid.surfaces
        if surface.surface_type == "GroundSurface"
    ]
    if not candidates:
        candidates = [surface for surface in solid.surfaces if _surface_at_ground(surface, solid)]
    polygons = [
        _polygonal(
            Polygon(
                [(x, y) for x, y, _z in surface.exterior_ring],
                [[(x, y) for x, y, _z in ring] for ring in surface.interior_rings],
            )
        )
        for surface in candidates
    ]
    return _polygonal(unary_union(polygons)) if polygons else Polygon()


def project_building_shadow(
    building: SelectedBuildingGeometry,
    solar: SolarPosition,
) -> ShadowProjectionResult:
    if solar.elevation_degrees <= 0 or solar.elevation_degrees >= 90:
        raise ValueError("太阳高度角必须大于 0 且小于 90 度。")
    projected_surfaces = [
        _project_surface(surface, solid.ground_z, solar)
        for solid in building.solids
        for surface in solid.surfaces
    ]
    footprints = [_solid_footprint(solid) for solid in building.solids]
    projected_union = _polygonal(unary_union(projected_surfaces))
    footprint_union = _polygonal(unary_union(footprints))
    shadow = _polygonal(projected_union.difference(footprint_union))
    return ShadowProjectionResult(
        building_id=building.building_id,
        shadow=shadow,
        footprint=footprint_union,
    )

