from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import geopandas as gpd
import pandas as pd
import pyogrio
from pyproj import CRS, Transformer
from shapely.geometry import box

from scripts.demo_area import DemoArea
from scripts.environment.config import GreenLayerDefinition


class EnvironmentInspectionError(ValueError):
    """Raw 环境数据没有通过 Schema Inspection 门禁。"""


@dataclass(frozen=True)
class GreenLayerInspection:
    path: str
    official_name: str
    official_definition: str
    include: bool
    reason: str
    format: str
    encoding: str
    crs: str
    fields: tuple[str, ...]
    feature_count: int
    geometry_types: tuple[str, ...]
    bounding_box: tuple[float, float, float, float]
    demo_intersection_count: int
    invalid_demo_geometry_count: int


@dataclass(frozen=True)
class DrinkingInspection:
    path: str
    format: str
    encoding: str
    columns: tuple[str, ...]
    row_count: int
    valid_coordinate_count: int
    missing_coordinate_count: int
    demo_area_count: int
    bounding_box: tuple[float, float, float, float]
    missing_values: dict[str, int]


def _demo_polygon(demo_area: DemoArea, target_crs: CRS):
    west, south, east, north = demo_area.bounding_box
    transformer = Transformer.from_crs("EPSG:4326", target_crs, always_xy=True)
    lower_left = transformer.transform(west, south)
    upper_right = transformer.transform(east, north)
    return box(lower_left[0], lower_left[1], upper_right[0], upper_right[1])


def inspect_green_layer(
    path: str | Path,
    definition: GreenLayerDefinition,
    demo_area: DemoArea,
) -> GreenLayerInspection:
    if definition.include is None:
        raise EnvironmentInspectionError(
            f"Green Layer {definition.official_name} 的语义尚未确认，禁止进入 Enrichment。"
        )
    path = Path(path)
    encoding = "cp932" if path.suffix.lower() == ".shp" else "utf-8"
    try:
        info = pyogrio.read_info(path, encoding=encoding)
        crs = CRS.from_user_input(info.get("crs"))
    except Exception as error:
        raise EnvironmentInspectionError(f"无法检查 Green Layer：{path}（{error}）") from error

    raw_geometry_type = str(info.get("geometry_type") or "")
    normalized_geometry_type = raw_geometry_type.replace(" Z", "")
    if definition.include and normalized_geometry_type not in ("Polygon", "MultiPolygon"):
        raise EnvironmentInspectionError(
            f"白名单 Green Layer {definition.official_name} 必须是 Polygon/MultiPolygon，"
            f"实际为 {raw_geometry_type or 'unknown'}。"
        )

    demo_polygon = _demo_polygon(demo_area, crs)
    local = gpd.read_file(path, bbox=demo_polygon.bounds, encoding=encoding)
    exact_local = local[local.geometry.intersects(demo_polygon)] if not local.empty else local
    geometry_types = tuple(
        sorted({value.replace(" Z", "") for value in [raw_geometry_type] if value})
    )
    total_bounds = tuple(float(value) for value in info["total_bounds"])
    return GreenLayerInspection(
        path=str(path),
        official_name=definition.official_name,
        official_definition=definition.official_definition,
        include=definition.include,
        reason=definition.reason,
        format="ESRI Shapefile" if path.suffix.lower() == ".shp" else path.suffix.lstrip("."),
        encoding=encoding,
        crs=crs.to_string(),
        fields=tuple(str(field) for field in info.get("fields", ())),
        feature_count=int(info.get("features", 0)),
        geometry_types=geometry_types,
        bounding_box=total_bounds,
        demo_intersection_count=len(exact_local),
        invalid_demo_geometry_count=int((~exact_local.geometry.is_valid).sum()),
    )


def inspect_drinking_csv(path: str | Path, demo_area: DemoArea) -> DrinkingInspection:
    path = Path(path)
    frame = None
    encoding = ""
    for candidate in ("utf-8", "cp932"):
        try:
            frame = pd.read_csv(path, encoding=candidate)
            encoding = candidate
            break
        except UnicodeDecodeError:
            continue
    if frame is None:
        raise EnvironmentInspectionError(f"无法识别 Drinking Station CSV Encoding：{path}")

    required = ("緯度", "経度", "施設名称", "所在地", "水飲み栓設置場所", "入場料等", "タイプ")
    missing_fields = [field for field in required if field not in frame.columns]
    if missing_fields:
        raise EnvironmentInspectionError(f"Drinking Station CSV 缺少字段：{missing_fields}")

    latitudes = pd.to_numeric(frame["緯度"], errors="coerce")
    longitudes = pd.to_numeric(frame["経度"], errors="coerce")
    valid = latitudes.between(-90, 90) & longitudes.between(-180, 180)
    if not valid.any():
        raise EnvironmentInspectionError("Drinking Station CSV 没有合法经纬度。")
    west, south, east, north = demo_area.bounding_box
    local = valid & latitudes.between(south, north) & longitudes.between(west, east)
    return DrinkingInspection(
        path=str(path),
        format="CSV",
        encoding=encoding,
        columns=tuple(str(column) for column in frame.columns),
        row_count=len(frame),
        valid_coordinate_count=int(valid.sum()),
        missing_coordinate_count=int((~valid).sum()),
        demo_area_count=int(local.sum()),
        bounding_box=(
            float(longitudes[valid].min()),
            float(latitudes[valid].min()),
            float(longitudes[valid].max()),
            float(latitudes[valid].max()),
        ),
        missing_values={str(column): int(count) for column, count in frame.isna().sum().items()},
    )
