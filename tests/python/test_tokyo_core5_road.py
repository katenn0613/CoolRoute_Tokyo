import unittest

import networkx as nx
from shapely.geometry import Polygon

from scripts.tokyo_core5.process_road import (
    union_ward_boundaries,
    validate_ward_coverage,
)


def boundary(west, south, east, north):
    return Polygon(((west, south), (east, south), (east, north), (west, north)))


class Core5RoadTests(unittest.TestCase):
    def setUp(self):
        self.boundaries = {
            "ward-a": boundary(139.70, 35.60, 139.72, 35.62),
            "ward-b": boundary(139.72, 35.60, 139.74, 35.62),
        }

    def test_union_preserves_both_adjacent_wards(self):
        merged = union_ward_boundaries(self.boundaries)

        self.assertAlmostEqual(merged.bounds[0], 139.70)
        self.assertAlmostEqual(merged.bounds[2], 139.74)
        self.assertGreater(merged.area, 0)

    def test_disconnected_per_ward_graph_does_not_pass(self):
        graph = nx.MultiDiGraph(crs="EPSG:4326")
        graph.add_node(1, x=139.71, y=35.61)
        graph.add_node(2, x=139.73, y=35.61)
        graph.add_edge(1, 1, key=0, length=1.0)
        graph.add_edge(2, 2, key=0, length=1.0)

        with self.assertRaisesRegex(ValueError, "跨区不可达"):
            validate_ward_coverage(graph, self.boundaries)

    def test_connected_union_graph_reports_each_ward(self):
        graph = nx.MultiDiGraph(crs="EPSG:4326")
        graph.add_node(1, x=139.71, y=35.61)
        graph.add_node(2, x=139.73, y=35.61)
        graph.add_edge(1, 2, key=0, length=100.0)
        graph.add_edge(2, 1, key=0, length=100.0)

        report = validate_ward_coverage(graph, self.boundaries)

        self.assertEqual(report["ward-a"]["nodeCount"], 1)
        self.assertEqual(report["ward-b"]["nodeCount"], 1)
        self.assertTrue(report["crossWardReachable"])


if __name__ == "__main__":
    unittest.main()
