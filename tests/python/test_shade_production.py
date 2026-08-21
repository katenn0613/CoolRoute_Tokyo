from __future__ import annotations

import json
from pathlib import Path
import unittest

from scripts.shade.publisher import validate_shade_payload


PROJECT_ROOT = Path(__file__).resolve().parents[2]


class ProductionShadeDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.graph = json.loads(
            (PROJECT_ROOT / "public/data/graph.json").read_text(encoding="utf-8")
        )
        cls.shade = json.loads(
            (PROJECT_ROOT / "public/data/shade.json").read_text(encoding="utf-8")
        )

    def test_sidecar_matches_every_production_edge(self):
        report = validate_shade_payload(self.shade, self.graph)

        self.assertEqual(report.edge_count, 16046)
        self.assertEqual(report.missing_edge_ids, ())
        self.assertEqual(report.unknown_edge_ids, ())

    def test_metadata_records_official_geometry_height_policy(self):
        metadata = self.shade["metadata"]

        self.assertEqual(metadata["sourceDatasetId"], "plateau-13101-chiyoda-ku-2023")
        self.assertEqual(metadata["heightSource"], "geometry-z-range")
        self.assertEqual(metadata["lodPolicy"], "complete-lod2-else-complete-lod1")
        self.assertEqual(metadata["scenarios"], ["09:00", "12:00", "15:00"])
        self.assertEqual(metadata["quality"]["parsedBuildingCount"], 20870)
        self.assertGreater(metadata["quality"]["lod2BuildingCount"], 0)
        self.assertGreater(metadata["quality"]["lod1FallbackCount"], 0)

    def test_each_scenario_has_real_nonzero_variation(self):
        values = tuple(self.shade["edgeShadeScores"].values())

        for index, scenario in enumerate(self.shade["metadata"]["scenarios"]):
            with self.subTest(scenario=scenario):
                scenario_values = tuple(item[index] for item in values)
                self.assertGreater(max(scenario_values), 0)
                self.assertGreater(len(set(scenario_values)), 10)
                self.assertTrue(all(0 <= value <= 1 for value in scenario_values))

    def test_road_graph_schema_and_environment_fields_remain_unchanged(self):
        self.assertEqual(self.graph["metadata"]["graphVersion"], "1.1.0")
        self.assertTrue(
            all(
                "green_score" in edge
                and "water_penalty" in edge
                and "shade_score" not in edge
                for edge in self.graph["edges"]
            )
        )


if __name__ == "__main__":
    unittest.main()
