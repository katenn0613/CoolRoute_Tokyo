from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.tokyo23.progress import MeshProgress


class Tokyo23ProgressTests(unittest.TestCase):
    def test_completed_mesh_is_skipped_after_restart(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "progress.json"
            progress = MeshProgress(path, pipeline="shade")
            progress.complete("53394500", {"edgeCount": 12})

            resumed = MeshProgress(path, pipeline="shade")

            self.assertTrue(resumed.is_completed("53394500"))
            self.assertEqual(resumed.completed["53394500"]["edgeCount"], 12)

    def test_failure_is_recorded_without_completing_mesh(self):
        with TemporaryDirectory() as directory:
            progress_path = Path(directory) / "progress.json"
            failure_path = Path(directory) / "failed_mesh_report.json"
            progress = MeshProgress(progress_path, pipeline="shade", failure_path=failure_path)

            progress.fail("53394501", "invalid CityGML")

            self.assertFalse(progress.is_completed("53394501"))
            self.assertEqual(progress.failures["53394501"]["error"], "invalid CityGML")
            self.assertTrue(failure_path.is_file())


if __name__ == "__main__":
    unittest.main()
