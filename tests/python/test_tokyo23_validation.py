import unittest

from scripts.tokyo23.validate_tokyo23 import validate_payloads


class Tokyo23ValidationTests(unittest.TestCase):
    def setUp(self):
        self.graph = {
            "metadata": {"graphVersion": "1.1.0", "generatedAt": "snapshot", "nodeCount": 2, "edgeCount": 1},
            "nodes": {"a": {"id": "a", "lon": 139.7, "lat": 35.6}, "b": {"id": "b", "lon": 139.8, "lat": 35.7}},
            "edges": [{
                "id": "a:b:0", "source": "a", "target": "b", "length": 10,
                "geometry": [[139.7, 35.6], [139.8, 35.7]],
                "green_score": 0.2, "water_penalty": 0.3,
            }],
        }
        self.shade = {
            "metadata": {
                "schemaVersion": "1.0.0", "scenarios": ["09:00", "12:00", "15:00"],
                "roadGraphSchemaVersion": "1.1.0", "roadGraphGeneratedAt": "snapshot", "edgeCount": 1,
                "quality": {"sourceMeshCount": 2, "processedSourceMeshCount": 1,
                            "coverageStatus": "substantially-complete", "missingSourceMeshIds": ["mesh-b"]},
            },
            "edgeShadeScores": {"a:b:0": [0.1, 0.2, 0.3]},
        }
        self.environment = {"graphSchemaVersion": "1.1.0", "quality": {"validationResult": "passed"}}
        self.stations = {"type": "FeatureCollection", "features": []}

    def test_valid_contract_reports_complete_edge_coverage(self):
        report = validate_payloads(self.graph, self.shade, self.environment, self.stations)

        self.assertEqual(report["result"], "passed")
        self.assertEqual(report["edgeCount"], 1)
        self.assertEqual(report["shadeEdgeCoverage"], 1.0)
        self.assertEqual(report["shadeSourceMeshCoverage"], 0.5)
        self.assertEqual(report["shadeCoverageStatus"], "substantially-complete")

    def test_missing_shade_edge_blocks_validation(self):
        self.shade["edgeShadeScores"] = {}

        with self.assertRaisesRegex(ValueError, "Shade Edge"):
            validate_payloads(self.graph, self.shade, self.environment, self.stations)


if __name__ == "__main__":
    unittest.main()
