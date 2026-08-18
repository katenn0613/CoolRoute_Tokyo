import json
from pathlib import Path
import unittest


class EnvironmentProductionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.baseline = json.loads(Path("data/processed/environment/graph_schema_1_0_baseline.json").read_text())
        cls.graph = json.loads(Path("public/data/graph.json").read_text())
        cls.metadata = json.loads(Path("public/data/environment_metadata.json").read_text())

    def test_enrichment_preserves_every_road_field(self):
        self.assertEqual(self.graph["metadata"]["graphVersion"], "1.1.0")
        self.assertEqual(self.graph["nodes"], self.baseline["nodes"])
        self.assertEqual(len(self.graph["edges"]), len(self.baseline["edges"]))
        for original, enriched in zip(self.baseline["edges"], self.graph["edges"], strict=True):
            self.assertEqual(
                {key: enriched[key] for key in ("id", "source", "target", "length", "geometry")},
                original,
            )

    def test_every_edge_has_finite_bounded_environment_fields(self):
        for edge in self.graph["edges"]:
            self.assertGreaterEqual(edge["green_score"], 0)
            self.assertLessEqual(edge["green_score"], 1)
            self.assertIn(edge["water_penalty"], (0, 0.3, 0.6, 1))

    def test_metadata_and_station_geojson_pass_quality_gate(self):
        self.assertEqual(self.metadata["quality"]["validationResult"], "passed")
        self.assertFalse(self.metadata["quality"]["greenScore"]["allValuesIdentical"])
        self.assertFalse(self.metadata["quality"]["waterPenalty"]["allValuesIdentical"])
        self.assertIn("extractionManifestSha256", json.loads(
            Path("data/processed/environment/schema_inspection.json").read_text()
        )["green"])
        stations = json.loads(Path("public/data/drinking_stations.geojson").read_text())
        self.assertEqual(len(stations["features"]), 5)
        self.assertTrue(all(item["geometry"]["type"] == "Point" for item in stations["features"]))
        self.assertTrue(all(set(item["properties"]) == {
            "name", "address", "location", "admissionFeeNote", "type", "sourceId"
        } for item in stations["features"]))


if __name__ == "__main__":
    unittest.main()
