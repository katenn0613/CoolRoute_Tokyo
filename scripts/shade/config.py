"""M10 Building Shade 的集中、确定性配置。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path


@dataclass(frozen=True)
class ShadeConfig:
    reference_date: date
    timezone: str
    scenarios: tuple[str, ...]
    analysis_crs: str
    graph_path: Path
    output_path: Path
    raw_directory: Path
    processed_directory: Path


def default_shade_config(project_root: Path = Path(".")) -> ShadeConfig:
    """返回 M10 已审阅通过的固定场景配置。"""

    root = Path(project_root)
    return ShadeConfig(
        reference_date=date(2026, 9, 23),
        timezone="Asia/Tokyo",
        scenarios=("09:00", "12:00", "15:00"),
        analysis_crs="EPSG:6677",
        graph_path=root / "public/data/graph.json",
        output_path=root / "public/data/shade.json",
        raw_directory=root / "data/raw/plateau",
        processed_directory=root / "data/processed/shade",
    )

