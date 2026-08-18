"""读取 React 与 Python 共用的 Demo Area 配置。"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path


DEFAULT_DEMO_AREA_PATH = Path("config/demo_area.json")


class DemoAreaConfigurationError(ValueError):
    """Demo Area 配置缺失或不合法。"""


@dataclass(frozen=True)
class DemoArea:
    id: str
    name: str
    center: tuple[float, float]
    zoom: float
    bounding_box: tuple[float, float, float, float]

    @property
    def osmnx_bbox(self) -> tuple[float, float, float, float]:
        """返回 OSMnx 2.x 的 (left, bottom, right, top) 顺序。"""

        return self.bounding_box

    def as_metadata(self) -> dict[str, object]:
        return {
            "id": self.id,
            "name": self.name,
            "center": list(self.center),
            "zoom": self.zoom,
            "boundingBox": list(self.bounding_box),
        }


def _finite_numbers(values: object, expected_length: int, field: str) -> tuple[float, ...]:
    if not isinstance(values, list) or len(values) != expected_length:
        raise DemoAreaConfigurationError(f"{field} 必须是长度为 {expected_length} 的数组。")
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in values):
        raise DemoAreaConfigurationError(f"{field} 只能包含数值。")
    converted = tuple(float(value) for value in values)
    if not all(math.isfinite(value) for value in converted):
        raise DemoAreaConfigurationError(f"{field} 只能包含有限数值。")
    return converted


def load_demo_area(path: Path = DEFAULT_DEMO_AREA_PATH) -> DemoArea:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise DemoAreaConfigurationError(f"无法读取 Demo Area 配置：{path}") from error

    try:
        area_id = payload["id"]
        name = payload["name"]
        zoom = float(payload["zoom"])
        center = _finite_numbers(payload["center"], 2, "center")
        bounding_box = _finite_numbers(payload["boundingBox"], 4, "boundingBox")
    except (KeyError, TypeError, ValueError) as error:
        raise DemoAreaConfigurationError("Demo Area 缺少必需字段或字段类型错误。") from error

    if not isinstance(area_id, str) or not area_id or not isinstance(name, str) or not name:
        raise DemoAreaConfigurationError("id 和 name 必须是非空字符串。")
    if not math.isfinite(zoom):
        raise DemoAreaConfigurationError("zoom 必须是有限数值。")

    west, south, east, north = bounding_box
    lon, lat = center
    if west >= east or south >= north:
        raise DemoAreaConfigurationError("boundingBox 必须满足 west < east 且 south < north。")
    if not (-180 <= west <= 180 and -180 <= east <= 180):
        raise DemoAreaConfigurationError("boundingBox 经度超出合法范围。")
    if not (-90 <= south <= 90 and -90 <= north <= 90):
        raise DemoAreaConfigurationError("boundingBox 纬度超出合法范围。")
    if not (west <= lon <= east and south <= lat <= north):
        raise DemoAreaConfigurationError("center 必须位于 boundingBox 内。")

    return DemoArea(
        id=area_id,
        name=name,
        center=(lon, lat),
        zoom=zoom,
        bounding_box=(west, south, east, north),
    )
