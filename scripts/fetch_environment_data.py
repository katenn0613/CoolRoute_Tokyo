"""获取并缓存 M4 官方环境 Raw 数据，不执行 GIS 处理。"""

from __future__ import annotations

import argparse
from dataclasses import asdict
import json
from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.data_sources.drinking_station_source import DrinkingStationSource
from scripts.data_sources.green_source import GreenSource
from scripts.data_sources.source_utils import download_file


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", choices=("all", "green", "water"), default="all")
    parser.add_argument("--force-download", action="store_true")
    return parser.parse_args()


def fetch_source(source, force_download: bool) -> list[dict[str, object]]:
    records = []
    for resource in source.resources:
        print(f"获取 {resource.filename}：{resource.url}", flush=True)
        record = download_file(
            resource.url,
            source.metadata.raw_directory / resource.filename,
            force_download=force_download,
        )
        item = asdict(record)
        item["path"] = str(record.path)
        item["license"] = resource.license
        item["role"] = resource.role
        records.append(item)
        cache_label = "缓存" if record.from_cache else "下载"
        print(f"  {cache_label}完成：{record.size_bytes:,} bytes，SHA-256 {record.sha256}", flush=True)

    metadata_path = source.metadata.raw_directory / "source_metadata.json"
    metadata_path.write_text(
        json.dumps(
            {
                "dataset": source.metadata.source_name,
                "provider": source.metadata.provider,
                "sourcePage": source.metadata.source_page,
                "resources": records,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return records


def main() -> None:
    args = parse_args()
    sources = []
    if args.source in ("all", "green"):
        sources.append(GreenSource())
    if args.source in ("all", "water"):
        sources.append(DrinkingStationSource())
    for source in sources:
        fetch_source(source, args.force_download)


if __name__ == "__main__":
    main()
