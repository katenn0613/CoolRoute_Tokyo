from pathlib import Path
from tempfile import TemporaryDirectory
import json
import unittest

from shapely.geometry import LineString

from scripts.shade.edge_scores import ProjectedEdge
from scripts.tokyo23.process_shade import (
    merge_interval_shards,
    merge_intervals,
    merge_score_shards,
    mesh_id_for_point,
    subtract_intervals,
)


class Tokyo23ShadeTests(unittest.TestCase):
    def test_coordinate_is_assigned_to_expected_third_mesh(self):
        self.assertEqual(mesh_id_for_point(139.7575, 35.683), "53394610")

    def test_score_shards_must_cover_every_graph_edge_once(self):
        graph = {"edges": [{"id": "a:b:0"}, {"id": "b:c:0"}]}
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "53394610.json").write_text(
                json.dumps({"a:b:0": [0.1, 0.2, 0.3]}), encoding="utf-8"
            )
            (root / "53394611.json").write_text(
                json.dumps({"b:c:0": [0.4, 0.5, 0.6]}), encoding="utf-8"
            )

            scores = merge_score_shards(graph, root)

        self.assertEqual(scores["a:b:0"], (0.1, 0.2, 0.3))
        self.assertEqual(scores["b:c:0"], (0.4, 0.5, 0.6))

    def test_missing_edge_score_blocks_production_merge(self):
        graph = {"edges": [{"id": "a:b:0"}, {"id": "b:c:0"}]}
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "53394610.json").write_text(
                json.dumps({"a:b:0": [0.1, 0.2, 0.3]}), encoding="utf-8"
            )

            with self.assertRaisesRegex(ValueError, "Edge coverage"):
                merge_score_shards(graph, root)

    def test_interval_union_and_footprint_subtraction_prevent_double_counting(self):
        self.assertEqual(merge_intervals(((0, 6), (4, 10))), ((0.0, 10.0),))
        self.assertEqual(
            subtract_intervals(((0, 10),), ((4, 6),)),
            ((0.0, 4.0), (6.0, 10.0)),
        )
        edge = ProjectedEdge("a:b:0", "a", "b", LineString([(0, 0), (10, 0)]), 10)
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "mesh-a.json").write_text(json.dumps({
                "a:b:0": {"shadow": [[[0, 6]], [[0, 6]], [[0, 6]]], "footprint": []},
            }), encoding="utf-8")
            (root / "mesh-b.json").write_text(json.dumps({
                "a:b:0": {"shadow": [[[4, 10]], [[4, 10]], [[4, 10]]], "footprint": [[4, 6]]},
            }), encoding="utf-8")

            scores = merge_interval_shards({edge.id: edge}, root)

        self.assertEqual(scores[edge.id], (0.8, 0.8, 0.8))


if __name__ == "__main__":
    unittest.main()
