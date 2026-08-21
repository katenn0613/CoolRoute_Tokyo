import unittest

import networkx as nx

from scripts.tokyo23.process_road import combine_ward_graphs


def graph(edges):
    result = nx.MultiDiGraph(crs="EPSG:4326")
    for source, target, key in edges:
        result.add_node(source, x=139.7 + source / 1000, y=35.6 + source / 1000)
        result.add_node(target, x=139.7 + target / 1000, y=35.6 + target / 1000)
        result.add_edge(source, target, key=key, length=10.0)
    return result


class Tokyo23RoadTests(unittest.TestCase):
    def test_ward_graphs_merge_without_duplicate_border_edges(self):
        first = graph(((1, 2, 0), (2, 3, 0)))
        second = graph(((2, 3, 0), (3, 4, 0)))

        merged = combine_ward_graphs((first, second))

        self.assertEqual(merged.number_of_nodes(), 4)
        self.assertEqual(merged.number_of_edges(), 3)


if __name__ == "__main__":
    unittest.main()
