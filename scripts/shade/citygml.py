"""M10 所需的最小 Project PLATEAU CityGML Building Parser。"""

from __future__ import annotations

from dataclasses import dataclass
import math
from pathlib import Path
from typing import Iterator
from xml.etree import ElementTree as ET


GML_ID = "{http://www.opengis.net/gml}id"
XLINK_HREF = "{http://www.w3.org/1999/xlink}href"


class CityGmlParseError(ValueError):
    """当前正式 CityGML 路径无法被安全解析。"""


Coordinate3D = tuple[float, float, float]


@dataclass(frozen=True)
class ParsedSurface:
    id: str | None
    surface_type: str | None
    exterior_ring: tuple[Coordinate3D, ...]
    interior_rings: tuple[tuple[Coordinate3D, ...], ...]


@dataclass(frozen=True)
class ParsedSolid:
    lod: int
    surfaces: tuple[ParsedSurface, ...]
    referenced_surface_ids: tuple[str, ...]
    unresolved_reference_ids: tuple[str, ...]


@dataclass(frozen=True)
class ParsedBuildingPart:
    id: str
    lod1: ParsedSolid
    lod2: ParsedSolid


@dataclass(frozen=True)
class ParsedBuilding:
    id: str
    measured_height: float | None
    lod1: ParsedSolid
    lod2: ParsedSolid
    parts: tuple[ParsedBuildingPart, ...]
    source_crs: str | None
    quality_flags: tuple[str, ...]


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _direct_children(element: ET.Element, local_name: str) -> tuple[ET.Element, ...]:
    return tuple(child for child in element if _local_name(child.tag) == local_name)


def _coordinate_values(element: ET.Element, dimension: int) -> tuple[Coordinate3D, ...]:
    try:
        values = tuple(float(value) for value in (element.text or "").split())
    except ValueError as error:
        raise CityGmlParseError("GML coordinate 包含非数值内容。") from error
    if dimension != 3 or not values or len(values) % dimension:
        raise CityGmlParseError("M10 Building Geometry 必须提供完整 XYZ 坐标。")
    coordinates = tuple(
        (values[index], values[index + 1], values[index + 2])
        for index in range(0, len(values), dimension)
    )
    if any(not all(math.isfinite(value) for value in coordinate) for coordinate in coordinates):
        raise CityGmlParseError("GML coordinate 包含 NaN 或 Infinity。")
    return coordinates


def _parse_linear_ring(ring: ET.Element) -> tuple[Coordinate3D, ...]:
    pos_lists = tuple(item for item in ring if _local_name(item.tag) == "posList")
    if pos_lists:
        pos_list = pos_lists[0]
        dimension = int(pos_list.attrib.get("srsDimension", ring.attrib.get("srsDimension", "3")))
        return _coordinate_values(pos_list, dimension)

    positions = tuple(item for item in ring if _local_name(item.tag) == "pos")
    if not positions:
        raise CityGmlParseError("LinearRing 缺少 posList 或 pos。")
    coordinates = []
    for position in positions:
        dimension = int(position.attrib.get("srsDimension", ring.attrib.get("srsDimension", "3")))
        parsed = _coordinate_values(position, dimension)
        if len(parsed) != 1:
            raise CityGmlParseError("单个 gml:pos 只能包含一个 XYZ 坐标。")
        coordinates.append(parsed[0])
    return tuple(coordinates)


def _ring_from_boundary(boundary: ET.Element) -> tuple[Coordinate3D, ...]:
    ring = next((item for item in boundary.iter() if _local_name(item.tag) == "LinearRing"), None)
    if ring is None:
        raise CityGmlParseError("Polygon boundary 缺少 LinearRing。")
    return _parse_linear_ring(ring)


def _parse_polygon(
    polygon: ET.Element,
    surface_type: str | None = None,
) -> ParsedSurface:
    exterior = next(
        (child for child in polygon if _local_name(child.tag) == "exterior"),
        None,
    )
    if exterior is None:
        raise CityGmlParseError("Polygon 缺少 exterior。")
    interiors = tuple(
        _ring_from_boundary(child)
        for child in polygon
        if _local_name(child.tag) == "interior"
    )
    return ParsedSurface(
        id=polygon.attrib.get(GML_ID),
        surface_type=surface_type,
        exterior_ring=_ring_from_boundary(exterior),
        interior_rings=interiors,
    )


def _surface_index(owner: ET.Element) -> dict[str, ParsedSurface]:
    index: dict[str, ParsedSurface] = {}
    indexed_elements: set[int] = set()
    semantic_surface_types = {
        "RoofSurface",
        "WallSurface",
        "GroundSurface",
        "OuterFloorSurface",
        "OuterCeilingSurface",
        "ClosureSurface",
    }
    for boundary in owner.iter():
        boundary_type = _local_name(boundary.tag)
        if boundary_type not in semantic_surface_types:
            continue
        for element in boundary.iter():
            if _local_name(element.tag) != "Polygon":
                continue
            surface = _parse_polygon(element, boundary_type)
            indexed_elements.add(id(element))
            if surface.id:
                index[surface.id] = surface
    for element in owner.iter():
        if _local_name(element.tag) != "Polygon" or id(element) in indexed_elements:
            continue
        surface = _parse_polygon(element)
        if surface.id:
            index[surface.id] = surface
    return index


def _parse_solid(
    owner: ET.Element,
    lod: int,
    surfaces_by_id: dict[str, ParsedSurface],
) -> ParsedSolid:
    surfaces: list[ParsedSurface] = []
    references: list[str] = []
    unresolved: list[str] = []
    seen: set[tuple[str, str | int]] = set()

    for solid_property in _direct_children(owner, f"lod{lod}Solid"):
        for member in solid_property.iter():
            if _local_name(member.tag) != "surfaceMember":
                continue
            href = member.attrib.get(XLINK_HREF)
            if href:
                reference_id = href.removeprefix("#")
                references.append(reference_id)
                surface = surfaces_by_id.get(reference_id) if href.startswith("#") else None
                if surface is None:
                    unresolved.append(reference_id)
                    continue
                key = ("id", reference_id)
                if key not in seen:
                    surfaces.append(surface)
                    seen.add(key)
                continue

            for polygon in member.iter():
                if _local_name(polygon.tag) != "Polygon":
                    continue
                polygon_id = polygon.attrib.get(GML_ID)
                surface = surfaces_by_id.get(polygon_id) if polygon_id else None
                if surface is None:
                    surface = _parse_polygon(polygon)
                key = ("id", surface.id) if surface.id else ("object", id(polygon))
                if key not in seen:
                    surfaces.append(surface)
                    seen.add(key)

    return ParsedSolid(
        lod=lod,
        surfaces=tuple(surfaces),
        referenced_surface_ids=tuple(references),
        unresolved_reference_ids=tuple(dict.fromkeys(unresolved)),
    )


def _parse_measured_height(building: ET.Element) -> float | None:
    element = next(
        (child for child in building if _local_name(child.tag) == "measuredHeight"),
        None,
    )
    if element is None or not (element.text or "").strip():
        return None
    try:
        value = float(element.text)
    except ValueError as error:
        raise CityGmlParseError("measuredHeight 不是数值。") from error
    return value if math.isfinite(value) else None


def _find_source_crs(building: ET.Element) -> str | None:
    return next(
        (
            element.attrib["srsName"]
            for element in building.iter()
            if element.attrib.get("srsName")
        ),
        None,
    )


def _parse_part(part: ET.Element) -> ParsedBuildingPart:
    index = _surface_index(part)
    return ParsedBuildingPart(
        id=part.attrib.get(GML_ID, ""),
        lod1=_parse_solid(part, 1, index),
        lod2=_parse_solid(part, 2, index),
    )


def _parse_building(
    building: ET.Element,
    inherited_source_crs: str | None = None,
) -> ParsedBuilding:
    building_id = building.attrib.get(GML_ID)
    if not building_id:
        raise CityGmlParseError("Building 缺少 gml:id。")
    index = _surface_index(building)
    parts = tuple(
        _parse_part(part)
        for consists in _direct_children(building, "consistsOfBuildingPart")
        for part in _direct_children(consists, "BuildingPart")
    )
    lod1 = _parse_solid(building, 1, index)
    lod2 = _parse_solid(building, 2, index)
    unresolved = (*lod1.unresolved_reference_ids, *lod2.unresolved_reference_ids)
    for part in parts:
        unresolved += (*part.lod1.unresolved_reference_ids, *part.lod2.unresolved_reference_ids)
    quality_flags = ("unresolved_xlink",) if unresolved else ()
    return ParsedBuilding(
        id=building_id,
        measured_height=_parse_measured_height(building),
        lod1=lod1,
        lod2=lod2,
        parts=parts,
        source_crs=_find_source_crs(building) or inherited_source_crs,
        quality_flags=quality_flags,
    )


def iter_buildings(path: Path) -> Iterator[ParsedBuilding]:
    """逐栋解析 PLATEAU Building，并在产出后释放对应 XML 子树。"""

    source_crs = None
    for event, element in ET.iterparse(Path(path), events=("start", "end")):
        if event == "start":
            if source_crs is None and element.attrib.get("srsName"):
                source_crs = element.attrib["srsName"]
            continue
        local_name = _local_name(element.tag)
        if local_name == "Building":
            yield _parse_building(element, source_crs)
            element.clear()
        elif local_name == "cityObjectMember":
            element.clear()
