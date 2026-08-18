"""数据源通用契约。

M1 只检查官方文件是否已由开发者放入本地目录，不执行网络下载或 GIS 处理。
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import Enum
import hashlib
import os
from pathlib import Path
import ssl
from typing import BinaryIO, Callable, NoReturn
from urllib.request import Request, urlopen

import certifi


class SourceStatus(str, Enum):
    READY = "ready"
    PENDING = "pending"
    NOT_STARTED = "not_started"
    AVAILABLE_NO_LOCAL_FEATURES = "available_no_local_features"
    UNAVAILABLE = "unavailable"
    INVALID = "invalid"


@dataclass(frozen=True)
class SourceMetadata:
    source_name: str
    provider: str
    source_page: str
    raw_directory: Path
    processed_directory: Path
    status: SourceStatus
    required: bool


@dataclass(frozen=True)
class RawDataValidation:
    available: bool
    matched_files: tuple[Path, ...]
    message: str


@dataclass(frozen=True)
class OfficialResource:
    filename: str
    url: str
    license: str
    role: str


@dataclass(frozen=True)
class DownloadRecord:
    path: Path
    url: str
    sha256: str
    size_bytes: int
    downloaded_at: str
    from_cache: bool


class SourceNotAvailableError(RuntimeError):
    """数据源尚未在本地可用。"""


def _open_official_url(url: str) -> BinaryIO:
    request = Request(url, headers={"User-Agent": "CoolRouteTokyo/0.1 official-data-loader"})
    context = ssl.create_default_context(cafile=certifi.where())
    return urlopen(request, timeout=120, context=context)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_file(
    url: str,
    destination: Path,
    force_download: bool = False,
    opener: Callable[[str], BinaryIO] = _open_official_url,
) -> DownloadRecord:
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    if destination.is_file() and not force_download:
        cached_at = datetime.fromtimestamp(destination.stat().st_mtime, UTC).isoformat().replace("+00:00", "Z")
        return DownloadRecord(
            path=destination,
            url=url,
            sha256=_sha256(destination),
            size_bytes=destination.stat().st_size,
            downloaded_at=cached_at,
            from_cache=True,
        )

    partial = destination.with_name(f"{destination.name}.partial")
    partial.unlink(missing_ok=True)
    try:
        with opener(url) as response, partial.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        if partial.stat().st_size == 0:
            raise OSError("官方资源响应为空。")

        if destination.exists():
            archive_directory = destination.parent / "archive"
            archive_directory.mkdir(exist_ok=True)
            timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
            archive_path = archive_directory / f"{destination.stem}-{timestamp}{destination.suffix}"
            os.replace(destination, archive_path)
        os.replace(partial, destination)
    except Exception as error:
        partial.unlink(missing_ok=True)
        raise SourceNotAvailableError(f"官方资源下载失败：{url}（{error}）") from error

    return DownloadRecord(
        path=destination,
        url=url,
        sha256=_sha256(destination),
        size_bytes=destination.stat().st_size,
        downloaded_at=now,
        from_cache=False,
    )


class BaseDataSource:
    def __init__(
        self,
        metadata: SourceMetadata,
        expected_suffixes: tuple[str, ...],
    ) -> None:
        self.metadata = metadata
        self.expected_suffixes = tuple(suffix.lower() for suffix in expected_suffixes)

    def download(self) -> NoReturn:
        raise SourceNotAvailableError(
            f"{self.metadata.source_name} 仍为 {self.metadata.status.value}。"
            f" 请从官方页面获取数据：{self.metadata.source_page}"
        )

    def validate_raw_data(self) -> RawDataValidation:
        raw_directory = self.metadata.raw_directory
        if not raw_directory.is_dir():
            return RawDataValidation(
                available=False,
                matched_files=(),
                message=f"未找到原始数据目录：{raw_directory}",
            )

        matched_files = tuple(
            sorted(
                (
                    path
                    for path in raw_directory.iterdir()
                    if path.is_file() and path.suffix.lower() in self.expected_suffixes
                ),
                key=lambda path: path.name,
            )
        )
        if not matched_files:
            suffixes = ", ".join(self.expected_suffixes)
            return RawDataValidation(
                available=False,
                matched_files=(),
                message=f"未找到预期原始文件（{suffixes}）：{raw_directory}",
            )

        return RawDataValidation(
            available=True,
            matched_files=matched_files,
            message=f"已找到 {len(matched_files)} 个候选原始文件，尚未执行内容验证。",
        )
