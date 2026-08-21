import unittest
from pathlib import Path
import tempfile
from unittest.mock import patch

import numpy as np
from shapely.geometry import LineString, Point, box

from scripts.environment.enrich_edges import (
    calculate_green_score,
    nearest_station_distance,
    water_penalty_for_distance,
)
from scripts.build_environment_graph import (
    _atomic_json,
    _covered_areas_by_edge,
    _publish_json_transaction,
)


class EnvironmentEnrichmentTests(unittest.TestCase):
    def setUp(self):
        self.edge = LineString([(0, 0), (100, 0)])

    def test_green_score_uses_union_and_never_double_counts_overlap(self):
        road_buffer = self.edge.buffer(15)
        self.assertAlmostEqual(calculate_green_score(self.edge, [road_buffer, road_buffer], 15), 1)
        self.assertEqual(calculate_green_score(self.edge, [], 15), 0)

    def test_vectorized_candidates_are_grouped_once_and_union_overlap(self):
        covered = _covered_areas_by_edge(
            edge_count=3,
            candidate_edge_indices=np.asarray([2, 0, 2]),
            clipped=np.asarray([box(0, 0, 2, 2), box(0, 0, 1, 1), box(1, 0, 3, 2)], dtype=object),
        )

        self.assertEqual(covered.tolist(), [1.0, 0.0, 6.0])

    def test_station_distance_uses_edge_geometry_not_end_nodes(self):
        self.assertAlmostEqual(nearest_station_distance(self.edge, [Point(50, 10)]), 10)

    def test_water_penalty_threshold_boundaries(self):
        self.assertEqual(water_penalty_for_distance(100), 0)
        self.assertEqual(water_penalty_for_distance(100.01), 0.3)
        self.assertEqual(water_penalty_for_distance(300), 0.3)
        self.assertEqual(water_penalty_for_distance(300.01), 0.6)
        self.assertEqual(water_penalty_for_distance(500), 0.6)
        self.assertEqual(water_penalty_for_distance(500.01), 1)

    def test_station_list_must_not_be_empty(self):
        with self.assertRaisesRegex(ValueError, "Drinking Station"):
            nearest_station_distance(self.edge, [])

    def test_failed_atomic_json_write_preserves_existing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "graph.json"
            output.write_text('{"stable":true}', encoding="utf-8")
            with self.assertRaises(TypeError):
                _atomic_json(output, {"invalid": object()})
            self.assertEqual(output.read_text(encoding="utf-8"), '{"stable":true}')

    def test_transaction_rolls_back_all_outputs_when_commit_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = [Path(directory) / name for name in ("a.json", "b.json", "c.json")]
            for path in paths:
                path.write_text('{"version":"old"}', encoding="utf-8")
            real_replace = __import__("os").replace
            commit_calls = 0

            def fail_second_commit(source, destination):
                nonlocal commit_calls
                if str(source).endswith(".tmp"):
                    commit_calls += 1
                    if commit_calls == 2:
                        raise OSError("synthetic second-file failure")
                return real_replace(source, destination)

            with patch("scripts.build_environment_graph.os.replace", side_effect=fail_second_commit):
                with self.assertRaises(OSError):
                    _publish_json_transaction({path: {"version": "new"} for path in paths})
            self.assertTrue(all(path.read_text() == '{"version":"old"}' for path in paths))

    def test_first_publish_failure_leaves_no_partial_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = [Path(directory) / name for name in ("a.json", "b.json", "c.json")]
            real_replace = __import__("os").replace
            commits = 0

            def fail_second_commit(source, destination):
                nonlocal commits
                if str(source).endswith(".tmp"):
                    commits += 1
                    if commits == 2:
                        raise OSError("synthetic first-publish failure")
                return real_replace(source, destination)

            with patch("scripts.build_environment_graph.os.replace", side_effect=fail_second_commit):
                with self.assertRaises(OSError):
                    _publish_json_transaction({path: {"new": True} for path in paths})
            self.assertTrue(all(not path.exists() for path in paths))


if __name__ == "__main__":
    unittest.main()
