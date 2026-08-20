from __future__ import annotations

import unittest

from shapely.geometry import LineString, Polygon, box

from scripts.shade.edge_scores import ProjectedEdge, calculate_edge_shade_scores


def edge(edge_id: str, coordinates) -> ProjectedEdge:
    geometry = LineString(coordinates)
    return ProjectedEdge(edge_id, "source", "target", geometry, geometry.length)


class EdgeShadeScoreTests(unittest.TestCase):
    def test_score_uses_projected_edge_geometry_length(self):
        scores = calculate_edge_shade_scores(
            (edge("a:b:0", ((0, 0), (10, 0))),),
            {
                "09:00": box(0, -1, 4, 1),
                "12:00": box(-1, -1, 11, 1),
                "15:00": Polygon(),
            },
            ("09:00", "12:00", "15:00"),
        )

        self.assertEqual(scores["a:b:0"], (0.4, 1.0, 0.0))

    def test_parallel_edges_keep_distinct_ids(self):
        edges = (
            edge("a:b:0", ((0, 0), (10, 0))),
            edge("a:b:1", ((0, 1), (10, 1))),
        )
        scores = calculate_edge_shade_scores(
            edges,
            {scenario: Polygon() for scenario in ("09:00", "12:00", "15:00")},
            ("09:00", "12:00", "15:00"),
        )

        self.assertEqual(set(scores), {"a:b:0", "a:b:1"})

    def test_missing_scenario_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "15:00"):
            calculate_edge_shade_scores(
                (edge("a:b:0", ((0, 0), (10, 0))),),
                {"09:00": Polygon(), "12:00": Polygon()},
                ("09:00", "12:00", "15:00"),
            )

    def test_zero_length_edge_is_rejected(self):
        invalid = ProjectedEdge("a:a:0", "a", "a", LineString(), 0)

        with self.assertRaisesRegex(ValueError, "a:a:0"):
            calculate_edge_shade_scores(
                (invalid,),
                {scenario: Polygon() for scenario in ("09:00", "12:00", "15:00")},
                ("09:00", "12:00", "15:00"),
            )


if __name__ == "__main__":
    unittest.main()
