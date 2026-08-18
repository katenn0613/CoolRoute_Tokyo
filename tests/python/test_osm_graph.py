import json
import math
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

import networkx as nx
from shapely.geometry import LineString

from scripts.demo_area import load_demo_area
from scripts.osm_graph import (
    BrowserGraphValidationError,
    OSMGraphValidationError,
    build_browser_graph,
    validate_browser_graph,
    validate_osm_graph,
    write_browser_graph,
)


def synthetic_valid_graph():
    """只用于测试的确定性合成图，不得写入 production data。"""

    graph = nx.MultiDiGraph(crs="EPSG:4326")
    graph.add_node(100, x=139.75, y=35.68)
    graph.add_node(200, x=139.751, y=35.681)
    graph.add_edge(
        100,
        200,
        key=0,
        length=150.0,
        geometry=LineString([(139.751, 35.681), (139.7505, 35.6805), (139.75, 35.68)]),
    )
    graph.add_edge(100, 200, key=1, length=151.0)
    graph.add_edge(
        200,
        100,
        key=0,
        length=150.0,
        geometry=LineString([(139.75, 35.68), (139.7505, 35.6805), (139.751, 35.681)]),
    )
    return graph


class OSMGraphTests(unittest.TestCase):
    def setUp(self):
        self.demo_area = load_demo_area()

    def test_preserves_parallel_directed_edges_and_orients_geometry(self):
        generated_at = datetime(2026, 8, 17, 12, 0, tzinfo=UTC)

        payload = build_browser_graph(
            synthetic_valid_graph(),
            self.demo_area,
            generated_at,
        )

        self.assertEqual(payload["metadata"]["graphVersion"], "1.0.0")
        self.assertEqual(payload["metadata"]["graphVersionMeaning"], "Browser Graph Schema Version")
        self.assertEqual(payload["metadata"]["nodeCount"], 2)
        self.assertEqual(payload["metadata"]["edgeCount"], 3)
        self.assertEqual(set(payload["nodes"]), {"100", "200"})
        self.assertEqual(
            [edge["id"] for edge in payload["edges"]],
            ["100:200:0", "100:200:1", "200:100:0"],
        )
        first_edge = payload["edges"][0]
        self.assertEqual(first_edge["geometry"][0], [139.75, 35.68])
        self.assertEqual(first_edge["geometry"][-1], [139.751, 35.681])
        fallback_edge = payload["edges"][1]
        self.assertEqual(
            fallback_edge["geometry"],
            [[139.75, 35.68], [139.751, 35.681]],
        )

    def test_rejects_non_positive_edge_length(self):
        graph = synthetic_valid_graph()
        graph.edges[100, 200, 0]["length"] = 0

        with self.assertRaisesRegex(OSMGraphValidationError, "length"):
            validate_osm_graph(graph, self.demo_area)

    def test_rejects_a_graph_that_is_not_weakly_connected_without_mutating_it(self):
        graph = synthetic_valid_graph()
        graph.add_node(300, x=139.752, y=35.682)
        before = (graph.number_of_nodes(), graph.number_of_edges())

        with self.assertRaisesRegex(OSMGraphValidationError, "弱连通"):
            validate_osm_graph(graph, self.demo_area)

        self.assertEqual((graph.number_of_nodes(), graph.number_of_edges()), before)

    def test_rejects_an_obviously_distant_connected_node(self):
        graph = synthetic_valid_graph()
        graph.add_node(999, x=140.5, y=36.5)
        graph.add_edge(200, 999, key=0, length=1000.0)
        graph.add_edge(999, 200, key=0, length=1000.0)

        with self.assertRaisesRegex(OSMGraphValidationError, "明显远离"):
            validate_osm_graph(graph, self.demo_area)

    def test_rejects_a_graph_whose_nodes_do_not_highly_overlap_the_demo_area(self):
        graph = synthetic_valid_graph()
        graph.add_node(300, x=139.743, y=35.68)
        graph.add_edge(100, 300, key=0, length=100.0)
        graph.add_edge(300, 100, key=0, length=100.0)

        with self.assertRaisesRegex(OSMGraphValidationError, "重合不足"):
            validate_osm_graph(graph, self.demo_area)

    def test_rejects_browser_edge_that_references_a_missing_node(self):
        payload = build_browser_graph(
            synthetic_valid_graph(),
            self.demo_area,
            datetime(2026, 8, 17, tzinfo=UTC),
        )
        payload["edges"][0]["target"] = "missing"

        with self.assertRaisesRegex(BrowserGraphValidationError, "不存在"):
            validate_browser_graph(payload, self.demo_area)

    def test_rejects_non_finite_browser_geometry(self):
        payload = build_browser_graph(
            synthetic_valid_graph(),
            self.demo_area,
            datetime(2026, 8, 17, tzinfo=UTC),
        )
        payload["edges"][0]["geometry"][0][0] = math.inf

        with self.assertRaisesRegex(BrowserGraphValidationError, "geometry"):
            validate_browser_graph(payload, self.demo_area)

    def test_writes_valid_json_atomically_and_reports_file_size(self):
        payload = build_browser_graph(
            synthetic_valid_graph(),
            self.demo_area,
            datetime(2026, 8, 17, tzinfo=UTC),
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_path = Path(temporary_directory) / "graph.json"

            size = write_browser_graph(payload, output_path)

            self.assertEqual(size, output_path.stat().st_size)
            self.assertEqual(
                json.loads(output_path.read_text(encoding="utf-8")),
                payload,
            )
            self.assertEqual(list(Path(temporary_directory).iterdir()), [output_path])


if __name__ == "__main__":
    unittest.main()
