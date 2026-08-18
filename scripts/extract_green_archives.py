#!/usr/bin/env python3
"""安全、确定性地从官方 Green ZIP 生成 inspected Shapefile 目录。"""
from __future__ import annotations

import hashlib
import argparse
import json
from pathlib import Path
import shutil
import zipfile


ARCHIVES = (
    Path("data/raw/green/03_jurinchi.zip"),
    Path("data/raw/green/10_koukyoushisetsu.zip"),
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_extract(archive: Path, destination: Path, manifest_only: bool = False) -> dict:
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    members = []
    with zipfile.ZipFile(archive, metadata_encoding="cp932") as bundle:
        for info in bundle.infolist():
            target = (destination / info.filename).resolve()
            if target != root and root not in target.parents:
                raise ValueError(f"ZIP 路径穿越被拒绝：{info.filename}")
            if manifest_only:
                if not info.is_dir() and (not target.is_file() or target.stat().st_size != info.file_size):
                    raise ValueError(f"已解压文件缺失或大小不符：{target}")
            elif info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(info) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)
            members.append({"name": info.filename, "size": info.file_size, "crc": info.CRC})
    return {"archive": str(archive), "sha256": sha256(archive), "members": members}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest-only", action="store_true")
    args = parser.parse_args()
    reports = []
    for archive in ARCHIVES:
        destination = Path("data/processed/green/extracted") / archive.name[:2]
        reports.append(safe_extract(archive, destination, manifest_only=args.manifest_only))
    output = Path("data/processed/green/extraction_manifest.json")
    output.write_text(json.dumps({"encoding": "cp932", "archives": reports}, ensure_ascii=False, indent=2) + "\n")
    print(output)


if __name__ == "__main__":
    main()
