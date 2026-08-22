#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.shade.publisher import validate_shade_payload


def validate_payloads(graph: dict, shade: dict, environment: dict, stations: dict) -> dict:
    metadata = graph.get("metadata", {})
    nodes = graph.get("nodes")
    edges = graph.get("edges")
    if metadata.get("graphVersion") != "1.1.0":
        raise ValueError("Tokyo23 Graph Schema 必须为 1.1.0。")
    if not isinstance(nodes, dict) or not isinstance(edges, list) or not nodes or not edges:
        raise ValueError("Tokyo23 Graph 缺少 Node/Edge。")
    if metadata.get("nodeCount") != len(nodes) or metadata.get("edgeCount") != len(edges):
        raise ValueError("Tokyo23 Graph metadata 计数不匹配。")
    edge_ids = set()
    for edge in edges:
        edge_id = edge.get("id")
        if not isinstance(edge_id, str) or edge_id in edge_ids:
            raise ValueError("Tokyo23 Graph Edge ID 缺失或重复。")
        edge_ids.add(edge_id)
        if edge.get("source") not in nodes or edge.get("target") not in nodes:
            raise ValueError(f"Edge {edge_id} 端点不存在。")
        if not isinstance(edge.get("length"), (int, float)) or edge["length"] <= 0:
            raise ValueError(f"Edge {edge_id} length 无效。")
        if not isinstance(edge.get("geometry"), list) or len(edge["geometry"]) < 2:
            raise ValueError(f"Edge {edge_id} geometry 无效。")
        for field in ("green_score", "water_penalty"):
            value = edge.get(field)
            if not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
                raise ValueError(f"Edge {edge_id} {field} 无效。")
    shade_report = validate_shade_payload(shade, graph)
    shade_quality = shade.get("metadata", {}).get("quality", {})
    source_mesh_count = shade_quality.get("sourceMeshCount")
    processed_mesh_count = shade_quality.get("processedSourceMeshCount", source_mesh_count)
    if not isinstance(source_mesh_count, int) or not isinstance(processed_mesh_count, int):
        raise ValueError("Tokyo23 Shade 缺少 Source Mesh 覆盖统计。")
    if not 0 < processed_mesh_count <= source_mesh_count:
        raise ValueError("Tokyo23 Shade Source Mesh 覆盖统计无效。")
    if environment.get("graphSchemaVersion") != "1.1.0":
        raise ValueError("Tokyo23 Environment metadata Graph Schema 不匹配。")
    if environment.get("quality", {}).get("validationResult") != "passed":
        raise ValueError("Tokyo23 Environment validation 未通过。")
    if stations.get("type") != "FeatureCollection" or not isinstance(stations.get("features"), list):
        raise ValueError("Tokyo23 Drinking Station GeoJSON 无效。")
    return {
        "result": "passed",
        "nodeCount": len(nodes),
        "edgeCount": len(edges),
        "shadeEdgeCoverage": shade_report.edge_count / len(edges),
        "shadeSourceMeshCoverage": processed_mesh_count / source_mesh_count,
        "shadeCoverageStatus": shade_quality.get("coverageStatus", "complete"),
        "missingShadeMeshIds": shade_quality.get("missingSourceMeshIds", []),
        "drinkingStationCount": len(stations["features"]),
        "graphSchemaVersion": "1.1.0",
        "shadeSchemaVersion": "1.0.0",
    }


def run(public_data: Path = Path("public/data")) -> dict:
    paths = {
        "graph": public_data / "graph_tokyo23.json",
        "shade": public_data / "shade_tokyo23.json",
        "environment": public_data / "environment_metadata_tokyo23.json",
        "stations": public_data / "drinking_stations_tokyo23.geojson",
    }
    missing = tuple(str(path) for path in paths.values() if not path.is_file())
    if missing:
        raise ValueError(f"Tokyo23 Production 文件缺失：{', '.join(missing)}")
    payloads = {name: json.loads(path.read_text(encoding="utf-8")) for name, path in paths.items()}
    report = validate_payloads(
        payloads["graph"], payloads["shade"], payloads["environment"], payloads["stations"],
    )
    report["files"] = {
        name: {"path": str(path), "sizeBytes": path.stat().st_size}
        for name, path in paths.items()
    }
    destination = Path("data/processed/tokyo23/validation_report.json")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="验证 Tokyo23 四个 Production 静态数据文件。")
    parser.add_argument("--public-data", type=Path, default=Path("public/data"))
    args = parser.parse_args()
    print(json.dumps(run(args.public_data), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
