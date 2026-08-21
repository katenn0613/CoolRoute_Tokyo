"""独立 Shade Sidecar 的确定性构建、验证与原子发布。"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import json
import math
from pathlib import Path
import tempfile

from .solar import SolarPosition


class ShadePayloadError(ValueError):
    """`shade.json` 不符合 production 数据契约。"""


@dataclass(frozen=True)
class ShadeValidationReport:
    edge_count: int
    missing_edge_ids: tuple[str, ...]
    unknown_edge_ids: tuple[str, ...]


def build_shade_payload(
    *,
    graph_payload: dict,
    source_metadata: dict,
    solar_positions: dict[str, SolarPosition],
    quality: dict,
    scores: dict[str, tuple[float, ...]],
    generated_at: str,
) -> dict:
    scenarios = tuple(solar_positions)
    graph_edges = tuple(graph_payload.get("edges", ()))
    graph_metadata = graph_payload.get("metadata", {})
    ordered_scores = {}
    for edge in graph_edges:
        edge_id = edge.get("id")
        if edge_id not in scores:
            continue
        ordered_scores[edge_id] = [round(value, 4) for value in scores[edge_id]]
    for edge_id in sorted(set(scores) - set(ordered_scores)):
        ordered_scores[edge_id] = [round(value, 4) for value in scores[edge_id]]

    return {
        "metadata": {
            "schemaVersion": "1.0.0",
            "dataset": source_metadata.get("dataset", "Project PLATEAU Chiyoda-ku 2023"),
            "provider": "国土交通省 Project PLATEAU",
            "sourceDatasetId": source_metadata.get("datasetId"),
            "generatedAt": generated_at,
            "referenceDate": "2026-09-23",
            "timezone": "Asia/Tokyo",
            "scenarios": list(scenarios),
            "solarAlgorithm": "Meeus/NOAA solar geometry (NREL SPA azimuth convention)",
            "atmosphericRefractionApplied": False,
            "lodPolicy": "complete-lod2-else-complete-lod1",
            "heightSource": "geometry-z-range",
            "roadGraphSchemaVersion": graph_metadata.get("graphVersion"),
            "roadGraphGeneratedAt": graph_metadata.get("generatedAt"),
            "edgeCount": len(graph_edges),
            "solarPositions": {
                scenario: {
                    "azimuthDegrees": position.azimuth_degrees,
                    "elevationDegrees": position.elevation_degrees,
                }
                for scenario, position in solar_positions.items()
            },
            "quality": deepcopy(quality),
        },
        "edgeShadeScores": ordered_scores,
    }


def deterministic_payload(payload: dict) -> dict:
    deterministic = deepcopy(payload)
    metadata = deterministic.get("metadata")
    if isinstance(metadata, dict):
        metadata.pop("generatedAt", None)
    return deterministic


def validate_shade_payload(payload: dict, graph_payload: dict) -> ShadeValidationReport:
    if not isinstance(payload, dict) or not isinstance(payload.get("metadata"), dict):
        raise ShadePayloadError("Shade payload 缺少 metadata。")
    metadata = payload["metadata"]
    if metadata.get("schemaVersion") != "1.0.0":
        raise ShadePayloadError("不支持的 Shade Schema Version。")
    scenarios = metadata.get("scenarios")
    if scenarios != ["09:00", "12:00", "15:00"]:
        raise ShadePayloadError("Shade 场景必须严格为 09:00、12:00、15:00。")
    graph_metadata = graph_payload.get("metadata", {})
    if metadata.get("roadGraphSchemaVersion") != graph_metadata.get("graphVersion"):
        raise ShadePayloadError("Shade 与 Road Graph Schema Version 不匹配。")

    graph_edge_ids = tuple(edge.get("id") for edge in graph_payload.get("edges", ()))
    score_payload = payload.get("edgeShadeScores")
    if not isinstance(score_payload, dict):
        raise ShadePayloadError("Shade payload 缺少 edgeShadeScores。")
    score_ids = set(score_payload)
    missing = tuple(edge_id for edge_id in graph_edge_ids if edge_id not in score_ids)
    graph_id_set = set(graph_edge_ids)
    unknown = tuple(edge_id for edge_id in score_payload if edge_id not in graph_id_set)
    if missing or unknown:
        raise ShadePayloadError(
            f"Shade Edge ID 不匹配：missing={len(missing)}，unknown={len(unknown)}"
        )
    if metadata.get("edgeCount") != len(graph_edge_ids):
        raise ShadePayloadError("Shade metadata Edge 数量与 Road Graph 不一致。")

    for edge_id, values in score_payload.items():
        if not isinstance(values, list) or len(values) != len(scenarios):
            raise ShadePayloadError(f"Edge {edge_id} 必须包含三个 Shade Score。")
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or value < 0
            or value > 1
            for value in values
        ):
            raise ShadePayloadError(f"Edge {edge_id} 包含无效 Shade Score。")
    return ShadeValidationReport(len(graph_edge_ids), missing, unknown)


def publish_shade_json(payload: dict, destination: Path) -> None:
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=destination.parent,
        prefix=f".{destination.name}.",
        suffix=".tmp",
        delete=False,
    )
    temporary_path = Path(handle.name)
    try:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        handle.write("\n")
        handle.close()
        json.loads(temporary_path.read_text(encoding="utf-8"))
        temporary_path.replace(destination)
    except Exception:
        handle.close()
        temporary_path.unlink(missing_ok=True)
        raise
