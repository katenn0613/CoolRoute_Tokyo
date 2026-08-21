from pathlib import Path
from tempfile import TemporaryDirectory
import json
import unittest

from scripts.tokyo23.process_shade import merge_score_shards, mesh_id_for_point


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


if __name__ == "__main__":
    unittest.main()
