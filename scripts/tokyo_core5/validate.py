#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
from pathlib import Path
import tempfile

from scripts.shade.publisher import validate_shade_payload
from scripts.tokyo_core5.config import CORE5_WARD_IDS


MAXIMUM_GRAPH_BYTES = 90 * 1024 * 1024


def _read(path: Path) -> dict:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Production 文件无法读取：{path}") from error


def validate_payloads(paths: dict[str, Path], maximum_graph_bytes: int = MAXIMUM_GRAPH_BYTES) -> dict:
    service = _read(paths["service"])
    features = service.get("features")
    ward_ids = features[0].get("properties", {}).get("wardIds") if isinstance(features, list) and features else None
    if tuple(ward_ids or ()) != CORE5_WARD_IDS:
        raise ValueError("Service Area 未包含 Core5 固定五区。")

    graph_path = Path(paths["graph"])
    if graph_path.stat().st_size >= maximum_graph_bytes:
        raise ValueError(f"Core5 Graph 文件大小达到发布上限：{graph_path.stat().st_size} bytes。")
    graph = _read(graph_path)
    metadata = graph.get("metadata", {})
    nodes = graph.get("nodes")
    edges = graph.get("edges")
    if metadata.get("graphVersion") != "1.1.0" or not isinstance(nodes, dict) or not isinstance(edges, list):
        raise ValueError("Core5 Graph Schema 1.1.0 契约无效。")
    if metadata.get("nodeCount") != len(nodes) or metadata.get("edgeCount") != len(edges):
        raise ValueError("Core5 Graph Node/Edge metadata 计数不一致。")
    node_ids = set(nodes)
    edge_ids = set()
    for edge in edges:
        if edge.get("id") in edge_ids or edge.get("source") not in node_ids or edge.get("target") not in node_ids:
            raise ValueError("Core5 Graph Edge ID 或端点无效。")
        edge_ids.add(edge["id"])
        for field in ("green_score", "water_penalty"):
            value = edge.get(field)
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or not 0 <= value <= 1:
                raise ValueError(f"Core5 Edge {edge.get('id')} 的 {field} 无效。")

    shade = _read(paths["shade"])
    shade_report = validate_shade_payload(shade, graph)
    stations = _read(paths["stations"])
    if stations.get("type") != "FeatureCollection" or not isinstance(stations.get("features"), list):
        raise ValueError("Core5 Drinking Station GeoJSON 无效。")
    environment = _read(paths["environment"])
    if environment.get("graphSchemaVersion") != "1.1.0":
        raise ValueError("Core5 Environment Metadata 与 Graph Schema 不匹配。")
    return {
        "result": "passed",
        "wardIds": list(CORE5_WARD_IDS),
        "nodeCount": len(nodes),
        "edgeCount": len(edges),
        "graphSizeBytes": graph_path.stat().st_size,
        "shadeEdgeCount": shade_report.edge_count,
        "drinkingStationCount": len(stations["features"]),
    }


def run(
    public_data: Path = Path("public/data"),
    output: Path = Path("data/processed/tokyo_core5/validation_report.json"),
) -> dict:
    report = validate_payloads({
        "graph": public_data / "graph_tokyo_core5.json",
        "shade": public_data / "shade_tokyo_core5.json",
        "environment": public_data / "environment_metadata_tokyo_core5.json",
        "stations": public_data / "drinking_stations_tokyo_core5.geojson",
        "service": public_data / "service_area_tokyo_core5.geojson",
    })
    output.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=output.parent,
        prefix=f".{output.name}.", suffix=".tmp", delete=False,
    )
    temporary = Path(handle.name)
    try:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        handle.close()
        os.replace(temporary, output)
    except Exception:
        handle.close()
        temporary.unlink(missing_ok=True)
        raise
    return report


if __name__ == "__main__":
    print(json.dumps(run(), ensure_ascii=False, indent=2))
