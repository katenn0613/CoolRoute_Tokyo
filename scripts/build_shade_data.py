#!/usr/bin/env python3
"""从官方 PLATEAU CityGML 构建 M10 独立 Shade Sidecar。"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
import json
import math
from pathlib import Path
import statistics
import sys
import time

from shapely.geometry import Polygon
from shapely.ops import unary_union

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.data_sources.plateau_source import (
    PLATEAU_DATASET_ID,
    PlateauSource,
    make_http_zip_entry_fetcher,
    official_plateau_entries,
)
from scripts.shade.citygml import iter_buildings
from scripts.shade.config import ShadeConfig, default_shade_config
from scripts.shade.edge_scores import calculate_edge_shade_scores, load_graph_edges
from scripts.shade.geometry import (
    BuildingGeometryError,
    project_building_geometry,
    select_building_geometry,
)
from scripts.shade.projection import project_building_shadow
from scripts.shade.publisher import (
    build_shade_payload,
    publish_shade_json,
    validate_shade_payload,
)
from scripts.shade.solar import build_solar_scenarios


@dataclass(frozen=True)
class ShadeBuildReport:
    raw_file_count: int
    parsed_building_count: int
    valid_building_count: int
    invalid_building_count: int
    lod2_building_count: int
    lod1_fallback_count: int
    edge_count: int
    scenarios: tuple[str, ...]
    height_min: float
    height_median: float
    height_max: float
    elapsed_seconds: float
    published: bool


class _GeometryAccumulator:
    """分批 union，避免把全部单栋 Polygon 长期留在内存。"""

    def __init__(self, batch_size: int = 500) -> None:
        self.batch_size = batch_size
        self.current = []
        self.batches = []

    def add(self, geometry) -> None:
        if geometry.is_empty:
            return
        self.current.append(geometry)
        if len(self.current) >= self.batch_size:
            self.batches.append(unary_union(self.current))
            self.current.clear()

    def finish(self):
        if self.current:
            self.batches.append(unary_union(self.current))
            self.current.clear()
        return unary_union(self.batches) if self.batches else Polygon()


def _expanded_bounds(bounds: list[float] | tuple[float, ...]) -> tuple[float, float, float, float]:
    if len(bounds) != 4 or any(not math.isfinite(float(value)) for value in bounds):
        raise ValueError("Road Graph 缺少有效 boundingBox。")
    west, south, east, north = (float(value) for value in bounds)
    # 约 500m 的保守影响边界；真实构建报告同时记录实际最大投影长度。
    return west - 0.006, south - 0.0045, east + 0.006, north + 0.0045


def _building_bounds(building) -> tuple[float, float, float, float]:
    coordinates = (
        coordinate
        for solid in building.solids
        for surface in solid.surfaces
        for ring in (surface.exterior_ring, *surface.interior_rings)
        for coordinate in ring
    )
    first = next(coordinates)
    minimum_x = maximum_x = first[0]
    minimum_y = maximum_y = first[1]
    for x, y, _z in coordinates:
        minimum_x = min(minimum_x, x)
        minimum_y = min(minimum_y, y)
        maximum_x = max(maximum_x, x)
        maximum_y = max(maximum_y, y)
    return minimum_x, minimum_y, maximum_x, maximum_y


def _intersects(first, second) -> bool:
    return not (
        first[2] < second[0]
        or second[2] < first[0]
        or first[3] < second[1]
        or second[3] < first[1]
    )


def run_pipeline(
    config: ShadeConfig,
    source: PlateauSource,
    *,
    graph_path: str | Path | None = None,
    publish: bool = True,
    force_download: bool = False,
    stage: str = "publish",
) -> ShadeBuildReport:
    started = time.perf_counter()
    graph_path = Path(graph_path or config.graph_path)
    graph_payload = json.loads(graph_path.read_text(encoding="utf-8"))
    graph_metadata = graph_payload.get("metadata", {})
    bounds = graph_metadata.get("boundingBox")
    center = graph_metadata.get("demoArea", {}).get("center")
    if not isinstance(center, list) or len(center) != 2:
        raise ValueError("Road Graph 缺少 Demo Area center。")

    entries = source.plan_entries(_expanded_bounds(bounds))
    if not entries:
        raise ValueError("PLATEAU 清单中没有覆盖 Demo Area 及阴影影响边界的建筑网格。")
    raw_paths = source.fetch_entries(entries, force_download=force_download)
    solar_positions = build_solar_scenarios(config, (float(center[0]), float(center[1])))
    edges = load_graph_edges(graph_path, config.analysis_crs) if stage != "geometry" else ()
    if edges:
        edge_bounds = tuple(edge.geometry.bounds for edge in edges)
        road_influence_bounds = (
            min(bounds[0] for bounds in edge_bounds) - 500,
            min(bounds[1] for bounds in edge_bounds) - 500,
            max(bounds[2] for bounds in edge_bounds) + 500,
            max(bounds[3] for bounds in edge_bounds) + 500,
        )
    else:
        road_influence_bounds = None

    parsed_count = 0
    invalid_count = 0
    lod2_count = 0
    lod1_count = 0
    heights: list[float] = []
    shade_building_count = 0
    shadows = {scenario: _GeometryAccumulator() for scenario in config.scenarios}
    footprints = _GeometryAccumulator()
    for raw_path in raw_paths:
        file_parsed_before = parsed_count
        for parsed in iter_buildings(raw_path):
            parsed_count += 1
            try:
                selected = select_building_geometry(parsed)
                selected = project_building_geometry(
                    selected,
                    parsed.source_crs or "",
                    config.analysis_crs,
                )
            except BuildingGeometryError:
                invalid_count += 1
                continue
            heights.append(selected.height)
            if selected.selected_lod == 2:
                lod2_count += 1
            else:
                lod1_count += 1
            if stage != "geometry":
                if not _intersects(_building_bounds(selected), road_influence_bounds):
                    continue
                shade_building_count += 1
                for scenario, solar in solar_positions.items():
                    result = project_building_shadow(selected, solar)
                    shadows[scenario].add(result.shadow)
                    if scenario == config.scenarios[0]:
                        footprints.add(result.footprint)
        print(
            f"processed {Path(raw_path).name}: buildings={parsed_count - file_parsed_before}",
            flush=True,
        )

    if not heights:
        raise ValueError("PLATEAU Raw 中没有可用于正式 Shade 的完整 LOD Geometry。")

    if stage == "geometry":
        edge_count = len(graph_payload.get("edges", ()))
        report = ShadeBuildReport(
            len(raw_paths), parsed_count, len(heights), invalid_count, lod2_count, lod1_count,
            edge_count, config.scenarios, min(heights), statistics.median(heights), max(heights),
            time.perf_counter() - started, False,
        )
        _write_report(config, report)
        return report

    footprint_union = footprints.finish()
    shadow_unions = {
        scenario: accumulator.finish().difference(footprint_union)
        for scenario, accumulator in shadows.items()
    }
    scores = calculate_edge_shade_scores(edges, shadow_unions, config.scenarios)
    if not any(value > 0 for values in scores.values() for value in values):
        raise ValueError(
            "Production Shade Score 全部为 0；请检查 PLATEAU 与 Road Graph 的 CRS/轴顺序。"
        )

    should_publish = publish and stage == "publish"
    quality = {
        "rawFileCount": len(raw_paths),
        "parsedBuildingCount": parsed_count,
        "validBuildingCount": len(heights),
        "shadeInfluenceBuildingCount": shade_building_count,
        "invalidBuildingCount": invalid_count,
        "lod2BuildingCount": lod2_count,
        "lod1FallbackCount": lod1_count,
        "geometryHeightMeters": {
            "min": round(min(heights), 3),
            "median": round(statistics.median(heights), 3),
            "max": round(max(heights), 3),
        },
        "shadowAreaSquareMeters": {
            scenario: round(geometry.area, 3)
            for scenario, geometry in shadow_unions.items()
        },
    }
    payload = build_shade_payload(
        graph_payload=graph_payload,
        source_metadata={"datasetId": PLATEAU_DATASET_ID},
        solar_positions=solar_positions,
        quality=quality,
        scores=scores,
        generated_at=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    )
    validate_shade_payload(payload, graph_payload)
    if should_publish:
        publish_shade_json(payload, config.output_path)

    report = ShadeBuildReport(
        raw_file_count=len(raw_paths),
        parsed_building_count=parsed_count,
        valid_building_count=len(heights),
        invalid_building_count=invalid_count,
        lod2_building_count=lod2_count,
        lod1_fallback_count=lod1_count,
        edge_count=len(edges),
        scenarios=config.scenarios,
        height_min=min(heights),
        height_median=statistics.median(heights),
        height_max=max(heights),
        elapsed_seconds=time.perf_counter() - started,
        published=should_publish,
    )
    _write_report(config, report)
    return report


def _write_report(config: ShadeConfig, report: ShadeBuildReport) -> None:
    report_directory = config.processed_directory / "reports"
    report_directory.mkdir(parents=True, exist_ok=True)
    (report_directory / "latest.json").write_text(
        json.dumps(asdict(report), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", choices=("geometry", "shadow", "publish"), default="publish")
    parser.add_argument("--force-download", action="store_true")
    parser.add_argument("--no-publish", action="store_true")
    arguments = parser.parse_args()
    config = default_shade_config(Path(__file__).resolve().parents[1])
    source = PlateauSource(
        entries=official_plateau_entries(),
        raw_directory=config.raw_directory,
        entry_fetcher=make_http_zip_entry_fetcher(),
    )
    report = run_pipeline(
        config,
        source,
        publish=not arguments.no_publish,
        force_download=arguments.force_download,
        stage=arguments.stage,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
