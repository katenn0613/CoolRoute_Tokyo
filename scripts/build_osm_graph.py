"""构建 CoolRoute Tokyo M2 浏览器道路图。"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import networkx as nx
import osmnx as ox

from scripts.data_sources import OSMSource, SourceNotAvailableError
from scripts.demo_area import DemoArea, DemoAreaConfigurationError, load_demo_area
from scripts.osm_graph import (
    BrowserGraphValidationError,
    GraphStatistics,
    OSMGraphValidationError,
    build_browser_graph,
    validate_browser_graph,
    validate_osm_graph,
    write_browser_graph,
)


DEFAULT_OUTPUT_PATH = Path("public/data/graph.json")


@dataclass(frozen=True)
class BuildResult:
    origin: str
    statistics: GraphStatistics
    output_size: int
    cache_path: Path
    cache_size: int
    output_path: Path


def run_build(
    source: OSMSource,
    demo_area: DemoArea,
    output_path: Path = DEFAULT_OUTPUT_PATH,
    force_download: bool = False,
    generated_at: datetime | None = None,
) -> BuildResult:
    graph, origin = source.load_or_download(
        demo_area,
        force_download=force_download,
    )
    validate_osm_graph(graph, demo_area)
    payload = build_browser_graph(
        graph,
        demo_area,
        generated_at or datetime.now(UTC),
    )
    statistics = validate_browser_graph(payload, demo_area)
    output_size = write_browser_graph(payload, output_path)
    cache_path = source.cache_path
    return BuildResult(
        origin=origin,
        statistics=statistics,
        output_size=output_size,
        cache_path=cache_path,
        cache_size=cache_path.stat().st_size if cache_path.is_file() else 0,
        output_path=output_path,
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="获取或加载真实 OSM walking network，并构建浏览器 Graph。"
    )
    parser.add_argument(
        "--force-download",
        action="store_true",
        help="忽略完整本地缓存并重新请求 OpenStreetMap/Overpass。",
    )
    parser.add_argument(
        "--demo-area",
        type=Path,
        default=Path("config/demo_area.json"),
        help="React 与 Python 共用的 Demo Area JSON。",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help="浏览器 Graph JSON 输出路径。",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        demo_area = load_demo_area(arguments.demo_area)
        result = run_build(
            source=OSMSource(),
            demo_area=demo_area,
            output_path=arguments.output,
            force_download=arguments.force_download,
        )
    except (
        SourceNotAvailableError,
        DemoAreaConfigurationError,
        OSMGraphValidationError,
        BrowserGraphValidationError,
        OSError,
    ) as error:
        print(f"M2 OSM Graph 构建失败：{error}", file=sys.stderr)
        return 1

    statistics = result.statistics
    print(f"Demo Area: {demo_area.name} ({demo_area.id})")
    print(f"OSM 来源: {'真实本地缓存' if result.origin == 'cache' else 'OpenStreetMap/Overpass 下载'}")
    print(f"OSMnx / NetworkX: {ox.__version__} / {nx.__version__}")
    print(f"Node 数量: {statistics.node_count}")
    print(f"Edge 数量: {statistics.edge_count}")
    print(f"平均 Edge Length: {statistics.average_edge_length:.3f} m")
    print(f"最大 Edge Length: {statistics.maximum_edge_length:.3f} m")
    print(f"实际节点范围: {list(statistics.actual_bounding_box)}")
    print(f"边界内 Node 比例: {statistics.in_bounds_node_ratio:.2%}")
    print(f"GraphML: {result.cache_path} ({result.cache_size} bytes)")
    print(f"Browser Graph: {result.output_path} ({result.output_size} bytes)")
    print("Browser Graph Schema Version: 1.0.0")
    print("Validation Result: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
