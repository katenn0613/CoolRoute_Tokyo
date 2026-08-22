from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path

from scripts.tokyo23.config import PlateauDataset, Ward


CORE5_WARD_IDS = ("13101", "13102", "13103", "13104", "13105")


@dataclass(frozen=True)
class Core5Config:
    id: str
    name: str
    center: tuple[float, float]
    zoom: float
    bounding_box: tuple[float, float, float, float]
    wards: tuple[Ward, ...]
    storage_limit_bytes: int
    plateau: PlateauDataset


def load_core5_config(path: Path = Path("config/tokyo_core5_area.json")) -> Core5Config:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    wards = tuple(
        Ward(str(item["id"]), str(item["name"]), str(item["query"]))
        for item in payload["wards"]
    )
    if tuple(ward.id for ward in wards) != CORE5_WARD_IDS:
        raise ValueError("Core5 配置必须按固定五区顺序包含千代田、中央、港、新宿、文京。")

    center = tuple(float(value) for value in payload["center"])
    bounds = tuple(float(value) for value in payload["boundingBox"])
    if len(center) != 2 or len(bounds) != 4 or not all(map(math.isfinite, (*center, *bounds))):
        raise ValueError("Core5 center/boundingBox 无效。")
    west, south, east, north = bounds
    if west >= east or south >= north or not (west <= center[0] <= east and south <= center[1] <= north):
        raise ValueError("Core5 边界或中心无效。")

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
    storage_limit = int(payload["storageLimitBytes"])
    if storage_limit <= 0:
        raise ValueError("Core5 storageLimitBytes 必须大于 0。")
    return Core5Config(
        id=str(payload["id"]),
        name=str(payload["name"]),
        center=center,
        zoom=float(payload["zoom"]),
        bounding_box=bounds,
        wards=wards,
        storage_limit_bytes=storage_limit,
        plateau=dataset,
    )
