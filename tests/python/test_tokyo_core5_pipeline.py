from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.tokyo_core5.progress import PipelineProgress
from scripts.tokyo_core5.run_pipeline import Stage, run_stages


class Core5PipelineTests(unittest.TestCase):
    def test_completed_stage_is_skipped_only_while_output_exists(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "road.json"
            calls = []

            def action():
                calls.append("road")
                output.write_text("{}", encoding="utf-8")
                return {"ok": True}

            progress = PipelineProgress(root / "progress.json")
            stages = (Stage("road", (output,), action),)
            run_stages(stages, progress)
            run_stages(stages, PipelineProgress(root / "progress.json"))
            self.assertEqual(calls, ["road"])

            output.unlink()
            run_stages(stages, PipelineProgress(root / "progress.json"))
            self.assertEqual(calls, ["road", "road"])

    def test_failed_stage_stops_following_stages(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            calls = []

            def fail():
                raise RuntimeError("boom")

            stages = (
                Stage("road", (root / "road",), fail),
                Stage("environment", (root / "environment",), lambda: calls.append("environment")),
            )
            with self.assertRaisesRegex(RuntimeError, "boom"):
                run_stages(stages, PipelineProgress(root / "progress.json"))
            self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
