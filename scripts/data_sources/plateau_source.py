"""Project PLATEAU 建筑 CityGML 的增量 Raw 缓存契约。"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
import json
import os
from pathlib import Path

from .source_utils import (
    BaseDataSource,
    SourceMetadata,
    SourceNotAvailableError,
    SourceStatus,
)


PLATEAU_DATASET_ID = "plateau-13101-chiyoda-ku-2023"
PLATEAU_ARCHIVE_URL = (
    "https://assets.cms.plateau.reearth.io/assets/f0/"
    "8694c9-c697-4c07-96fc-720b6f61b06b/"
    "13101_chiyoda-ku_pref_2023_citygml_2_op.zip"
)


@dataclass(frozen=True)
class PlateauEntry:
    mesh_id: str
    archive_path: str
    bounds: tuple[float, float, float, float]
    compressed_size: int
    uncompressed_size: int
    dataset_id: str = PLATEAU_DATASET_ID


EntryFetcher = Callable[[str, str], bytes]


def _missing_entry_fetcher(_archive_url: str, archive_path: str) -> bytes:
    raise SourceNotAvailableError(
        "尚未配置 PLATEAU ZIP Entry 获取器，无法读取官方文件："
        f"{archive_path}"
    )


def _bounds_intersect(
    first: tuple[float, float, float, float],
    second: tuple[float, float, float, float],
) -> bool:
    first_west, first_south, first_east, first_north = first
    second_west, second_south, second_east, second_north = second
    return not (
        first_east < second_west
        or second_east < first_west
        or first_north < second_south
        or second_north < first_south
    )


class PlateauSource(BaseDataSource):
    def __init__(
        self,
        entries: Iterable[PlateauEntry] = (),
        raw_directory: str | Path = "data/raw/plateau/",
        entry_fetcher: EntryFetcher = _missing_entry_fetcher,
    ) -> None:
        raw_path = Path(raw_directory)
        super().__init__(
            metadata=SourceMetadata(
                source_name="Project PLATEAU Chiyoda-ku 2023 Buildings",
                provider="国土交通省 Project PLATEAU",
                source_page=(
                    "https://www.geospatial.jp/ckan/dataset/"
                    "plateau-13101-chiyoda-ku-2023"
                ),
                raw_directory=raw_path,
                processed_directory=Path("data/processed/shade/"),
                status=SourceStatus.PENDING,
                required=True,
            ),
            expected_suffixes=(".gml", ".xml", ".json"),
        )
        self.entries = tuple(entries)
        self.entry_fetcher = entry_fetcher

    def plan_entries(
        self,
        graph_bounds: tuple[float, float, float, float],
    ) -> tuple[PlateauEntry, ...]:
        return tuple(
            sorted(
                (
                    entry
                    for entry in self.entries
                    if "/bldg/" in f"/{entry.archive_path.lstrip('/')}"
                    and entry.archive_path.endswith("_bldg_6697_op.gml")
                    and _bounds_intersect(entry.bounds, graph_bounds)
                ),
                key=lambda entry: (entry.mesh_id, entry.archive_path),
            )
        )

    def fetch_entries(
        self,
        entries: Iterable[PlateauEntry],
        force_download: bool = False,
    ) -> tuple[Path, ...]:
        paths = []
        for entry in entries:
            destination = self.metadata.raw_directory / Path(entry.archive_path).name
            metadata_path = destination.with_suffix(".metadata.json")
            if destination.is_file() and metadata_path.is_file() and not force_download:
                paths.append(destination)
                continue

            try:
                content = self.entry_fetcher(PLATEAU_ARCHIVE_URL, entry.archive_path)
            except SourceNotAvailableError:
                raise
            except Exception as error:
                raise SourceNotAvailableError(
                    f"PLATEAU 官方 ZIP Entry 获取失败：{entry.archive_path}（{error}）"
                ) from error
            if not isinstance(content, bytes) or not content:
                raise SourceNotAvailableError(
                    f"PLATEAU 官方 ZIP Entry 响应为空或类型无效：{entry.archive_path}"
                )

            self._write_entry_atomically(entry, destination, metadata_path, content)
            paths.append(destination)
        return tuple(paths)

    def _write_entry_atomically(
        self,
        entry: PlateauEntry,
        destination: Path,
        metadata_path: Path,
        content: bytes,
    ) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        partial = destination.with_suffix(f"{destination.suffix}.partial")
        metadata_partial = metadata_path.with_suffix(f"{metadata_path.suffix}.partial")
        partial.unlink(missing_ok=True)
        metadata_partial.unlink(missing_ok=True)
        retrieved_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        metadata = {
            "datasetId": entry.dataset_id,
            "provider": "国土交通省 Project PLATEAU",
            "sourceArchiveUrl": PLATEAU_ARCHIVE_URL,
            "archiveEntry": entry.archive_path,
            "meshId": entry.mesh_id,
            "retrievedAt": retrieved_at,
            "sizeBytes": len(content),
            "compressedSize": entry.compressed_size,
            "uncompressedSize": entry.uncompressed_size,
            "bounds": list(entry.bounds),
        }
        try:
            partial.write_bytes(content)
            metadata_partial.write_text(
                json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            self._archive_existing(destination, metadata_path)
            os.replace(partial, destination)
            os.replace(metadata_partial, metadata_path)
        except Exception as error:
            partial.unlink(missing_ok=True)
            metadata_partial.unlink(missing_ok=True)
            raise SourceNotAvailableError(
                f"无法原子缓存 PLATEAU Raw：{destination}（{error}）"
            ) from error

    @staticmethod
    def _archive_existing(destination: Path, metadata_path: Path) -> None:
        existing = tuple(path for path in (destination, metadata_path) if path.exists())
        if not existing:
            return
        archive_directory = destination.parent / "archive"
        archive_directory.mkdir(exist_ok=True)
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
        for path in existing:
            os.replace(path, archive_directory / f"{path.stem}.{stamp}{path.suffix}")

