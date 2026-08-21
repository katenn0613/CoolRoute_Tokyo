#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import UTC, datetime
import json
import os
from pathlib import Path
import re
import ssl
import sys
import tempfile
from urllib.request import Request, urlopen

import certifi

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.data_sources import DrinkingStationSource, GreenSource
from scripts.data_sources.plateau_source import (
    PlateauEntry,
    RemoteZipReader,
    is_building_entry_path,
    mesh_bounds,
)
from scripts.tokyo23.config import Tokyo23Config, load_tokyo23_config


def discover_building_entries(
    reader: RemoteZipReader,
    config: Tokyo23Config,
) -> tuple[PlateauEntry, ...]:
    entries = []
    for record in reader.list_records():
        if not is_building_entry_path(record.path):
            continue
        match = re.search(r"/(\d{8})_bldg_", f"/{record.path}")
        if match is None:
            continue
        mesh_id = match.group(1)
        entries.append(PlateauEntry(
            mesh_id=mesh_id,
            archive_path=record.path,
            bounds=mesh_bounds(mesh_id),
            compressed_size=record.compressed_size,
            uncompressed_size=record.uncompressed_size,
            dataset_id=config.plateau.dataset_id,
        ))
    return tuple(sorted(entries, key=lambda entry: (entry.mesh_id, entry.archive_path)))


def open_official_archive(config: Tokyo23Config, timeout: int = 120):
    context = ssl.create_default_context(cafile=certifi.where())
    request = Request(
        config.plateau.archive_url,
        method="HEAD",
        headers={"User-Agent": "CoolRouteTokyo/0.1 official-data-loader"},
    )
    with urlopen(request, timeout=timeout, context=context) as response:
        size = int(response.headers["Content-Length"])
        headers = {
            "etag": response.headers.get("ETag"),
            "lastModified": response.headers.get("Last-Modified"),
            "acceptRanges": response.headers.get("Accept-Ranges"),
        }
    if headers["acceptRanges"] != "bytes":
        raise ValueError("PLATEAU Tokyo23 归档不支持 HTTP Range。")

    def read_range(start: int, end: int) -> bytes:
        range_request = Request(
            config.plateau.archive_url,
            headers={
                "User-Agent": "CoolRouteTokyo/0.1 official-data-loader",
                "Range": f"bytes={start}-{end}",
            },
        )
        with urlopen(range_request, timeout=timeout, context=context) as response:
            content = response.read()
        if len(content) != end - start + 1:
            raise ValueError("PLATEAU Tokyo23 HTTP Range 长度不匹配。")
        return content

    return RemoteZipReader(size, read_range), size, headers


def write_plateau_manifest(
    destination: Path,
    config: Tokyo23Config,
    archive_size: int,
    headers: dict,
    entries: tuple[PlateauEntry, ...],
) -> None:
    payload = {
        "datasetId": config.plateau.dataset_id,
        "datasetYear": config.plateau.dataset_year,
        "provider": "国土交通省 Project PLATEAU",
        "catalogUrl": config.plateau.catalog_url,
        "archiveUrl": config.plateau.archive_url,
        "license": config.plateau.license,
        "inspectedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "archiveSizeBytes": archive_size,
        "archiveHeaders": headers,
        "buildingEntryCount": len(entries),
        "buildingCompressedBytes": sum(entry.compressed_size for entry in entries),
        "buildingUncompressedBytes": sum(entry.uncompressed_size for entry in entries),
        "entries": [
            {
                "meshId": entry.mesh_id,
                "archivePath": entry.archive_path,
                "bounds": list(entry.bounds),
                "compressedSize": entry.compressed_size,
                "uncompressedSize": entry.uncompressed_size,
            }
            for entry in entries
        ],
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=destination.parent,
        prefix=f".{destination.name}.", suffix=".tmp", delete=False,
    )
    temporary = Path(handle.name)
    try:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        handle.close()
        os.replace(temporary, destination)
    except Exception:
        handle.close()
        temporary.unlink(missing_ok=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description="审计 Tokyo23 官方源并建立增量 PLATEAU manifest。")
    parser.add_argument("--force-download", action="store_true")
    parser.add_argument(
        "--manifest", type=Path,
        default=Path("data/processed/tokyo23/plateau_manifest.json"),
    )
    args = parser.parse_args()
    config = load_tokyo23_config()
    GreenSource().fetch(force_download=args.force_download)
    DrinkingStationSource().fetch(force_download=args.force_download)
    reader, archive_size, headers = open_official_archive(config)
    entries = discover_building_entries(reader, config)
    if not entries:
        raise ValueError("PLATEAU Tokyo23 归档不包含建筑 CityGML。")
    if max(entry.uncompressed_size for entry in entries) > config.storage_limit_bytes:
        raise ValueError("单个 PLATEAU mesh 超出本机存储上限。")
    write_plateau_manifest(args.manifest, config, archive_size, headers, entries)
    print(json.dumps({
        "plateauBuildingEntryCount": len(entries),
        "buildingCompressedBytes": sum(entry.compressed_size for entry in entries),
        "buildingUncompressedBytes": sum(entry.uncompressed_size for entry in entries),
        "manifest": str(args.manifest),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
