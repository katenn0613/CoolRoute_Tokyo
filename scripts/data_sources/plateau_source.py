"""Project PLATEAU 建筑 CityGML 的增量 Raw 缓存契约。"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
import binascii
import json
import os
from pathlib import Path
import re
import ssl
import struct
import zlib
from urllib.request import Request, urlopen

import certifi

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
RangeReader = Callable[[int, int], bytes]


@dataclass(frozen=True)
class _ZipRecord:
    path: str
    compression: int
    flags: int
    crc32: int
    compressed_size: int
    uncompressed_size: int
    local_header_offset: int


class RemoteZipReader:
    """通过 HTTP Range 等随机读取器只提取 ZIP 中需要的 Entry。"""

    def __init__(self, size: int, read_range: RangeReader) -> None:
        if size <= 0:
            raise ValueError("ZIP size 必须大于零。")
        self.size = size
        self.read_range = read_range
        self._records: dict[str, _ZipRecord] | None = None

    def _index(self) -> dict[str, _ZipRecord]:
        if self._records is not None:
            return self._records
        tail_size = min(self.size, 65_557)
        tail_start = self.size - tail_size
        tail = self.read_range(tail_start, self.size - 1)
        marker = tail.rfind(b"PK\x05\x06")
        if marker < 0 or marker + 22 > len(tail):
            raise SourceNotAvailableError("PLATEAU ZIP 缺少有效 EOCD。")
        (_signature, disk, central_disk, _disk_entries, total_entries,
         central_size, central_offset, _comment_length) = struct.unpack_from(
            "<4s4H2LH", tail, marker
        )
        if disk != 0 or central_disk != 0:
            raise SourceNotAvailableError("PLATEAU ZIP 不支持多磁盘归档。")
        if (
            total_entries == 0xFFFF
            or central_size == 0xFFFFFFFF
            or central_offset == 0xFFFFFFFF
        ):
            eocd_offset = tail_start + marker
            if eocd_offset < 20:
                raise SourceNotAvailableError("PLATEAU ZIP64 缺少 EOCD Locator。")
            locator = self.read_range(eocd_offset - 20, eocd_offset - 1)
            if locator[:4] != b"PK\x06\x07":
                raise SourceNotAvailableError("PLATEAU ZIP64 缺少有效 EOCD Locator。")
            (_locator_signature, zip64_disk, zip64_offset, total_disks) = struct.unpack(
                "<4sLQL", locator
            )
            if zip64_disk != 0 or total_disks != 1:
                raise SourceNotAvailableError("PLATEAU ZIP64 不支持多磁盘归档。")
            zip64 = self.read_range(zip64_offset, zip64_offset + 55)
            if zip64[:4] != b"PK\x06\x06":
                raise SourceNotAvailableError("PLATEAU ZIP64 EOCD 损坏。")
            (_zip64_signature, _record_size, _made_by, _needed, disk, central_disk,
             _disk_entries, total_entries, central_size, central_offset) = struct.unpack(
                "<4sQ2H2L4Q", zip64
            )
            if disk != 0 or central_disk != 0:
                raise SourceNotAvailableError("PLATEAU ZIP64 不支持多磁盘归档。")
        central = self.read_range(central_offset, central_offset + central_size - 1)
        records: dict[str, _ZipRecord] = {}
        cursor = 0
        for _ in range(total_entries):
            if central[cursor : cursor + 4] != b"PK\x01\x02":
                raise SourceNotAvailableError("PLATEAU ZIP Central Directory 损坏。")
            values = struct.unpack_from("<4s6H3L5H2L", central, cursor)
            flags, compression = values[3], values[4]
            crc32, compressed_size, uncompressed_size = values[7:10]
            name_length, extra_length, comment_length = values[10:13]
            local_header_offset = values[16]
            name_start = cursor + 46
            name_bytes = central[name_start : name_start + name_length]
            extra_start = name_start + name_length
            extra = central[extra_start : extra_start + extra_length]
            if (
                uncompressed_size == 0xFFFFFFFF
                or compressed_size == 0xFFFFFFFF
                or local_header_offset == 0xFFFFFFFF
            ):
                zip64_values: tuple[int, ...] | None = None
                extra_cursor = 0
                while extra_cursor + 4 <= len(extra):
                    header_id, data_size = struct.unpack_from("<HH", extra, extra_cursor)
                    data_start = extra_cursor + 4
                    data_end = data_start + data_size
                    if data_end > len(extra):
                        raise SourceNotAvailableError("PLATEAU ZIP64 Extra Field 损坏。")
                    if header_id == 0x0001:
                        if data_size % 8:
                            raise SourceNotAvailableError("PLATEAU ZIP64 Extra Field 长度无效。")
                        zip64_values = struct.unpack(
                            f"<{data_size // 8}Q", extra[data_start:data_end]
                        )
                        break
                    extra_cursor = data_end
                if zip64_values is None:
                    raise SourceNotAvailableError("PLATEAU ZIP Entry 缺少 ZIP64 Extra Field。")
                values = iter(zip64_values)
                try:
                    if uncompressed_size == 0xFFFFFFFF:
                        uncompressed_size = next(values)
                    if compressed_size == 0xFFFFFFFF:
                        compressed_size = next(values)
                    if local_header_offset == 0xFFFFFFFF:
                        local_header_offset = next(values)
                except StopIteration as error:
                    raise SourceNotAvailableError(
                        "PLATEAU ZIP64 Extra Field 缺少必需值。"
                    ) from error
            encoding = "utf-8" if flags & 0x800 else "cp437"
            path = name_bytes.decode(encoding)
            records[path] = _ZipRecord(
                path=path,
                compression=compression,
                flags=flags,
                crc32=crc32,
                compressed_size=compressed_size,
                uncompressed_size=uncompressed_size,
                local_header_offset=local_header_offset,
            )
            cursor = name_start + name_length + extra_length + comment_length
        self._records = records
        return records

    def read_entry(self, path: str) -> bytes:
        record = self._index().get(path)
        if record is None:
            raise SourceNotAvailableError(f"PLATEAU ZIP 中不存在 Entry：{path}")
        if record.flags & 0x1:
            raise SourceNotAvailableError(f"PLATEAU ZIP Entry 不应加密：{path}")
        header = self.read_range(record.local_header_offset, record.local_header_offset + 29)
        if header[:4] != b"PK\x03\x04":
            raise SourceNotAvailableError(f"PLATEAU ZIP Local Header 损坏：{path}")
        local_values = struct.unpack_from("<4s5H3L2H", header)
        name_length, extra_length = local_values[9:11]
        data_start = record.local_header_offset + 30 + name_length + extra_length
        compressed = self.read_range(data_start, data_start + record.compressed_size - 1)
        if record.compression == 0:
            content = compressed
        elif record.compression == 8:
            content = zlib.decompress(compressed, -zlib.MAX_WBITS)
        else:
            raise SourceNotAvailableError(
                f"PLATEAU ZIP Entry 使用不支持的压缩方法 {record.compression}：{path}"
            )
        if len(content) != record.uncompressed_size:
            raise SourceNotAvailableError(f"PLATEAU ZIP Entry 解压长度不匹配：{path}")
        if binascii.crc32(content) & 0xFFFFFFFF != record.crc32:
            raise SourceNotAvailableError(f"PLATEAU ZIP Entry CRC 校验失败：{path}")
        return content

    def list_records(self) -> tuple[_ZipRecord, ...]:
        """返回 Central Directory 中的确定性 Entry 清单，不读取 Entry 内容。"""

        return tuple(self._index()[path] for path in sorted(self._index()))


def _mesh_bounds(mesh_id: str) -> tuple[float, float, float, float]:
    if len(mesh_id) != 8 or not mesh_id.isdigit():
        raise ValueError(f"无效的日本第三次地域区划 Mesh ID：{mesh_id}")
    first_lat, first_lon = int(mesh_id[:2]), int(mesh_id[2:4])
    second_lat, second_lon = int(mesh_id[4]), int(mesh_id[5])
    third_lat, third_lon = int(mesh_id[6]), int(mesh_id[7])
    south = first_lat / 1.5 + second_lat * (5 / 60) + third_lat * (30 / 3600)
    west = 100 + first_lon + second_lon * (7.5 / 60) + third_lon * (45 / 3600)
    return (west, south, west + 45 / 3600, south + 30 / 3600)


def mesh_bounds(mesh_id: str) -> tuple[float, float, float, float]:
    """返回日本第三次地域区划 Mesh 的 EPSG:4326 边界。"""

    return _mesh_bounds(mesh_id)


def is_building_entry_path(path: str) -> bool:
    return bool(
        re.search(r"(?:^|/)udx/bldg/[^/]+_bldg_6697(?:_2)?_op\.gml$", path)
    )


_OFFICIAL_BUILDING_ENTRY_SIZES = (
    ("53394509", 15399369, 126865098), ("53394518", 2978326, 30667511),
    ("53394519", 845058, 11344298), ("53394528", 3192376, 45760719),
    ("53394529", 890257, 15580058), ("53394538", 1276459, 30086566),
    ("53394539", 2080717, 30221154), ("53394549", 4680320, 59738904),
    ("53394600", 16020140, 145424961), ("53394601", 26234586, 224464071),
    ("53394610", 2662051, 22055561), ("53394611", 20182692, 168142617),
    ("53394620", 2105913, 17731384), ("53394621", 30691764, 253788173),
    ("53394622", 11575573, 125483467), ("53394630", 8183811, 84729890),
    ("53394631", 27502330, 235772855), ("53394632", 10348423, 125266984),
    ("53394640", 2499169, 38153351), ("53394641", 9424936, 106302504),
    ("53394642", 8818584, 135219572),
)


def official_plateau_entries() -> tuple[PlateauEntry, ...]:
    """返回已从官方 2023 千代田区 ZIP Central Directory 审计的建筑清单。"""

    return tuple(
        PlateauEntry(
            mesh_id=mesh_id,
            archive_path=f"udx/bldg/{mesh_id}_bldg_6697_op.gml",
            bounds=_mesh_bounds(mesh_id),
            compressed_size=compressed_size,
            uncompressed_size=uncompressed_size,
        )
        for mesh_id, compressed_size, uncompressed_size in _OFFICIAL_BUILDING_ENTRY_SIZES
    )


def make_http_zip_entry_fetcher(timeout: int = 120) -> EntryFetcher:
    readers: dict[str, RemoteZipReader] = {}
    context = ssl.create_default_context(cafile=certifi.where())

    def fetch(archive_url: str, archive_path: str) -> bytes:
        reader = readers.get(archive_url)
        if reader is None:
            head_request = Request(
                archive_url,
                method="HEAD",
                headers={"User-Agent": "CoolRouteTokyo/0.1 official-data-loader"},
            )
            with urlopen(head_request, timeout=timeout, context=context) as response:
                size = int(response.headers["Content-Length"])

            def read_range(start: int, end: int) -> bytes:
                request = Request(
                    archive_url,
                    headers={
                        "User-Agent": "CoolRouteTokyo/0.1 official-data-loader",
                        "Range": f"bytes={start}-{end}",
                    },
                )
                with urlopen(request, timeout=timeout, context=context) as response:
                    content = response.read()
                expected = end - start + 1
                if len(content) != expected:
                    raise SourceNotAvailableError(
                        f"PLATEAU HTTP Range 长度不匹配：expected={expected}, actual={len(content)}"
                    )
                return content

            reader = RemoteZipReader(size, read_range)
            readers[archive_url] = reader
        return reader.read_entry(archive_path)

    return fetch


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
        archive_url: str = PLATEAU_ARCHIVE_URL,
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
        self.archive_url = archive_url

    def plan_entries(
        self,
        graph_bounds: tuple[float, float, float, float],
    ) -> tuple[PlateauEntry, ...]:
        return tuple(
            sorted(
                (
                    entry
                    for entry in self.entries
                    if is_building_entry_path(entry.archive_path)
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
                content = self.entry_fetcher(self.archive_url, entry.archive_path)
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
            "sourceArchiveUrl": self.archive_url,
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
