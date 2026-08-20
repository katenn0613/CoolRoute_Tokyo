"""M10 太阳位置的数据契约；正式固定场景算法在本模块集中实现。"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SolarPosition:
    """方位角从正北顺时针，高度角从地平线向上。"""

    azimuth_degrees: float
    elevation_degrees: float

