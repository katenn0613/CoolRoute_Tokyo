import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

from scripts.build_osm_graph import run_build
from scripts.data_sources import SourceNotAvailableError
from scripts.demo_area import load_demo_area
from tests.python.test_osm_graph import synthetic_valid_graph


class FailingSource:
    def load_or_download(self, demo_area, force_download=False):
        raise SourceNotAvailableError("synthetic test-only source failure")


class SyntheticSuccessfulSource:
    cache_path = Path("synthetic-test-only.graphml")

    def load_or_download(self, demo_area, force_download=False):
        return synthetic_valid_graph(), "cache"


class BuildOSMGraphTests(unittest.TestCase):
    def test_source_failure_does_not_create_a_production_json(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_path = Path(temporary_directory) / "graph.json"

            with self.assertRaises(SourceNotAvailableError):
                run_build(
                    source=FailingSource(),
                    demo_area=load_demo_area(),
                    output_path=output_path,
                    generated_at=datetime(2026, 8, 17, tzinfo=UTC),
                )

            self.assertFalse(output_path.exists())

    def test_successful_build_returns_valid_statistics(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_path = Path(temporary_directory) / "graph.json"

            result = run_build(
                source=SyntheticSuccessfulSource(),
                demo_area=load_demo_area(),
                output_path=output_path,
                generated_at=datetime(2026, 8, 17, tzinfo=UTC),
            )

            self.assertEqual(result.origin, "cache")
            self.assertEqual(result.statistics.node_count, 2)
            self.assertEqual(result.statistics.edge_count, 3)
            self.assertEqual(result.output_size, output_path.stat().st_size)


if __name__ == "__main__":
    unittest.main()
