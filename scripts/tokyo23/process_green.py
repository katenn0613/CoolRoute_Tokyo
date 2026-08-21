#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.build_environment_graph import build


OUTPUT_NAMES = {
    "graph.json": "graph_tokyo23.json",
    "environment_metadata.json": "environment_metadata_tokyo23.json",
    "drinking_stations.geojson": "drinking_stations_tokyo23.geojson",
}


def _publish(staging: Path, output_directory: Path) -> None:
    output_directory.mkdir(parents=True, exist_ok=True)
    temporary_files = {}
    try:
        for source_name, destination_name in OUTPUT_NAMES.items():
            source = staging / source_name
            if not source.is_file():
                raise ValueError(f"Tokyo23 Environment 缺少输出：{source_name}")
            handle = tempfile.NamedTemporaryFile(
                dir=output_directory, prefix=f".{destination_name}.", suffix=".tmp", delete=False,
            )
            temporary = Path(handle.name)
            handle.close()
            shutil.copyfile(source, temporary)
            temporary_files[output_directory / destination_name] = temporary
        for destination, temporary in temporary_files.items():
            os.replace(temporary, destination)
    finally:
        for temporary in temporary_files.values():
            temporary.unlink(missing_ok=True)


def run(
    baseline: Path = Path("data/processed/tokyo23/graph_schema_1_0_baseline.json"),
    output_directory: Path = Path("public/data"),
) -> dict:
    staging = Path("data/processed/tokyo23/environment_staging")
    shutil.rmtree(staging, ignore_errors=True)
    metadata = build(
        baseline,
        Path("data/processed/environment/schema_inspection.json"),
        Path("data/raw/drinking_station/tokyowaterdrinkingstation_250917.csv"),
        staging,
        area_path=Path("config/tokyo23_area.json"),
        cache_prefix="tokyo23",
    )
    graph = json.loads((staging / "graph.json").read_text(encoding="utf-8"))
    if graph.get("metadata", {}).get("graphVersion") != "1.1.0":
        raise ValueError("Tokyo23 Graph Schema 不是 1.1.0。")
    _publish(staging, output_directory)
    shutil.rmtree(staging, ignore_errors=True)
    Path("data/processed/green/tokyo23_green_whitelist.gpkg").unlink(missing_ok=True)
    Path("data/processed/green/tokyo23_green_fragments_100m.gpkg").unlink(missing_ok=True)
    return {
        "edgeCount": graph["metadata"]["edgeCount"],
        "greenValidation": metadata["quality"]["validationResult"],
        "outputs": [str(output_directory / value) for value in OUTPUT_NAMES.values()],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="复用 M4 公式生成 Tokyo23 Green/Water Production Data。")
    parser.add_argument("--output-dir", type=Path, default=Path("public/data"))
    args = parser.parse_args()
    print(json.dumps(run(output_directory=args.output_dir), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
