from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.shade.publisher import (
    ShadePayloadError,
    build_shade_payload,
    deterministic_payload,
    publish_shade_json,
    validate_shade_payload,
)
from scripts.shade.solar import SolarPosition


def graph_payload():
    return {
        "metadata": {"graphVersion": "1.1.0", "generatedAt": "graph-time", "edgeCount": 2},
        "edges": [{"id": "a:b:0"}, {"id": "b:c:0"}],
    }


def payload(generated_at="2026-08-21T00:00:00Z"):
    return build_shade_payload(
        graph_payload=graph_payload(),
        source_metadata={"datasetId": "plateau-13101-chiyoda-ku-2023"},
        solar_positions={
            "09:00": SolarPosition(110, 35),
            "12:00": SolarPosition(180, 55),
            "15:00": SolarPosition(250, 30),
        },
        quality={"lod2BuildingCount": 10, "lod1FallbackCount": 2},
        scores={"b:c:0": (0.0, 0.5, 1.0), "a:b:0": (0.123456, 0.2, 0.3)},
        generated_at=generated_at,
    )


class ShadePublisherTests(unittest.TestCase):
    def test_generated_at_does_not_change_deterministic_result(self):
        first = payload("2026-08-21T00:00:00Z")
        second = payload("2026-08-22T00:00:00Z")

        self.assertEqual(deterministic_payload(first), deterministic_payload(second))
        self.assertNotEqual(first["metadata"]["generatedAt"], second["metadata"]["generatedAt"])

    def test_payload_uses_graph_edge_order_and_rounds_after_calculation(self):
        result = payload()

        self.assertEqual(tuple(result["edgeShadeScores"]), ("a:b:0", "b:c:0"))
        self.assertEqual(result["edgeShadeScores"]["a:b:0"], [0.1235, 0.2, 0.3])
        report = validate_shade_payload(result, graph_payload())
        self.assertEqual(report.missing_edge_ids, ())
        self.assertEqual(report.unknown_edge_ids, ())

    def test_missing_or_unknown_edge_is_rejected(self):
        candidate = payload()
        del candidate["edgeShadeScores"]["a:b:0"]
        candidate["edgeShadeScores"]["unknown"] = [0, 0, 0]

        with self.assertRaisesRegex(ShadePayloadError, "missing=1.*unknown=1"):
            validate_shade_payload(candidate, graph_payload())

    def test_non_finite_or_out_of_range_score_is_rejected(self):
        for invalid in (float("nan"), float("inf"), -0.1, 1.1):
            with self.subTest(invalid=invalid):
                candidate = payload()
                candidate["edgeShadeScores"]["a:b:0"][0] = invalid
                with self.assertRaises(ShadePayloadError):
                    validate_shade_payload(candidate, graph_payload())

    def test_publish_writes_parseable_json_without_leaving_temp_file(self):
        with TemporaryDirectory() as directory:
            destination = Path(directory) / "shade.json"

            publish_shade_json(payload(), destination)

            self.assertEqual(json.loads(destination.read_text(encoding="utf-8")), payload())
            self.assertEqual(tuple(Path(directory).glob("*.tmp")), ())


if __name__ == "__main__":
    unittest.main()
