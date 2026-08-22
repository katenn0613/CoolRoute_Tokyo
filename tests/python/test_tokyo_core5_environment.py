import unittest

from scripts.tokyo_core5.process_environment import OUTPUT_NAMES, validate_enriched_graph


class Core5EnvironmentTests(unittest.TestCase):
    def test_output_names_are_isolated_from_demo_and_tokyo23(self):
        self.assertEqual(OUTPUT_NAMES["graph.json"], "graph_tokyo_core5.json")
        self.assertEqual(
            OUTPUT_NAMES["drinking_stations.geojson"],
            "drinking_stations_tokyo_core5.geojson",
        )

    def test_graph_requires_schema_1_1_and_bounded_environment_fields(self):
        graph = {
            "metadata": {"graphVersion": "1.1.0", "edgeCount": 1},
            "edges": [{"id": "1:2:0", "green_score": 0.4, "water_penalty": 0.6}],
        }

        self.assertEqual(validate_enriched_graph(graph), 1)
        graph["edges"][0]["green_score"] = 1.1
        with self.assertRaisesRegex(ValueError, "green_score"):
            validate_enriched_graph(graph)


if __name__ == "__main__":
    unittest.main()
