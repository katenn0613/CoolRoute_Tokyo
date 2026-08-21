from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path


@dataclass(frozen=True)
class Ward:
    id: str
    name: str
    query: str


@dataclass(frozen=True)
class PlateauDataset:
    dataset_id: str
    dataset_year: int
    archive_url: str
    catalog_url: str
    license: str


@dataclass(frozen=True)
class Tokyo23Config:
    id: str
    name: str
    center: tuple[float, float]
    zoom: float
    bounding_box: tuple[float, float, float, float]
    wards: tuple[Ward, ...]
    storage_limit_bytes: int
    plateau: PlateauDataset


def load_tokyo23_config(path: Path = Path("config/tokyo23_area.json")) -> Tokyo23Config:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    wards = tuple(Ward(str(item["id"]), str(item["name"]), str(item["query"])) for item in payload["wards"])
    ids = tuple(ward.id for ward in wards)
    if len(wards) != 23 or len(set(ids)) != 23:
        raise ValueError("Tokyo23 配置必须包含 23 个唯一特别区。")
    center = tuple(float(value) for value in payload["center"])
    bounds = tuple(float(value) for value in payload["boundingBox"])
    if len(center) != 2 or len(bounds) != 4 or not all(map(math.isfinite, (*center, *bounds))):
        raise ValueError("Tokyo23 center/boundingBox 无效。")
    west, south, east, north = bounds
    if west >= east or south >= north or not (west <= center[0] <= east and south <= center[1] <= north):
        raise ValueError("Tokyo23 边界或中心无效。")
    storage_limit = int(payload["storageLimitBytes"])
    if storage_limit <= 0:
        raise ValueError("Tokyo23 storageLimitBytes 必须大于 0。")
    plateau = payload["plateau"]
    dataset = PlateauDataset(
        dataset_id=str(plateau["datasetId"]),
        dataset_year=int(plateau["datasetYear"]),
        archive_url=str(plateau["archiveUrl"]),
        catalog_url=str(plateau["catalogUrl"]),
        license=str(plateau["license"]),
    )
    if not dataset.archive_url.startswith("https://") or not dataset.catalog_url.startswith("https://"):
        raise ValueError("PLATEAU 正式来源必须使用 HTTPS。")
    return Tokyo23Config(
        id=str(payload["id"]), name=str(payload["name"]), center=center,
        zoom=float(payload["zoom"]), bounding_box=bounds, wards=wards,
        storage_limit_bytes=storage_limit, plateau=dataset,
    )
