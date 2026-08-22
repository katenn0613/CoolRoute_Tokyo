#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import shutil
import sys
import tempfile

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.build_environment_graph import build


OUTPUT_NAMES = {
    "graph.json": "graph_tokyo_core5.json",
    "environment_metadata.json": "environment_metadata_tokyo_core5.json",
    "drinking_stations.geojson": "drinking_stations_tokyo_core5.geojson",
}


def validate_enriched_graph(graph: dict) -> int:
    if graph.get("metadata", {}).get("graphVersion") != "1.1.0":
        raise ValueError("Core5 Graph Schema 不是 1.1.0。")
    edges = graph.get("edges")
    if not isinstance(edges, list) or not edges:
        raise ValueError("Core5 Environment Graph 缺少 Edge。")
    for edge in edges:
        for field in ("green_score", "water_penalty"):
            value = edge.get(field)
            if (
                not isinstance(value, (int, float))
                or isinstance(value, bool)
                or not math.isfinite(value)
                or not 0 <= value <= 1
            ):
                raise ValueError(f"Edge {edge.get('id')} 的 {field} 无效。")
    if graph["metadata"].get("edgeCount") != len(edges):
        raise ValueError("Core5 Environment Graph Edge 计数不一致。")
    return len(edges)


def _publish(staging: Path, output_directory: Path) -> None:
    output_directory.mkdir(parents=True, exist_ok=True)
    temporary_files = {}
    try:
        for source_name, destination_name in OUTPUT_NAMES.items():
            source = staging / source_name
            if not source.is_file():
                raise ValueError(f"Core5 Environment 缺少输出：{source_name}")
            handle = tempfile.NamedTemporaryFile(
                dir=output_directory,
                prefix=f".{destination_name}.",
                suffix=".tmp",
                delete=False,
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
    baseline: Path = Path("data/processed/tokyo_core5/graph_schema_1_0_baseline.json"),
    output_directory: Path = Path("public/data"),
    area_path: Path = Path("config/tokyo_core5_area.json"),
) -> dict[str, object]:
    staging = Path("data/processed/tokyo_core5/environment_staging")
    shutil.rmtree(staging, ignore_errors=True)
    metadata = build(
        baseline,
        Path("data/processed/environment/schema_inspection.json"),
        Path("data/raw/drinking_station/tokyowaterdrinkingstation_250917.csv"),
        staging,
        area_path=area_path,
        cache_prefix="tokyo_core5",
    )
    graph = json.loads((staging / "graph.json").read_text(encoding="utf-8"))
    edge_count = validate_enriched_graph(graph)
    _publish(staging, output_directory)
    shutil.rmtree(staging, ignore_errors=True)
    Path("data/processed/green/tokyo_core5_green_whitelist.gpkg").unlink(missing_ok=True)
    Path("data/processed/green/tokyo_core5_green_fragments_100m.gpkg").unlink(missing_ok=True)
    return {
        "edgeCount": edge_count,
        "greenValidation": metadata["quality"]["validationResult"],
        "outputs": [str(output_directory / value) for value in OUTPUT_NAMES.values()],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="复用 M4 公式生成东京都心5区 Green/Water 数据。")
    parser.add_argument("--baseline", type=Path, default=Path("data/processed/tokyo_core5/graph_schema_1_0_baseline.json"))
    parser.add_argument("--output-dir", type=Path, default=Path("public/data"))
    parser.add_argument("--area", type=Path, default=Path("config/tokyo_core5_area.json"))
    args = parser.parse_args()
    print(json.dumps(run(args.baseline, args.output_dir, args.area), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
