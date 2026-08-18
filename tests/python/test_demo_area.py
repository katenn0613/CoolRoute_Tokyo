import json
import tempfile
import unittest
from pathlib import Path

from scripts.demo_area import DemoAreaConfigurationError, load_demo_area


class DemoAreaTests(unittest.TestCase):
    def test_loads_the_repository_single_source_of_truth(self):
        area = load_demo_area(Path("config/demo_area.json"))

        self.assertEqual(area.id, "temporary_demo_area")
        self.assertEqual(area.center, (139.7575, 35.683))
        self.assertEqual(
            area.osmnx_bbox,
            (139.744, 35.672, 139.771, 35.694),
        )

    def test_rejects_a_bbox_with_reversed_axes(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "demo_area.json"
            path.write_text(
                json.dumps(
                    {
                        "id": "synthetic_invalid_area",
                        "name": "Synthetic invalid area",
                        "center": [139.75, 35.68],
                        "zoom": 14,
                        "boundingBox": [139.8, 35.7, 139.7, 35.6],
                    }
                ),
                encoding="utf-8",
            )

            with self.assertRaises(DemoAreaConfigurationError):
                load_demo_area(path)


if __name__ == "__main__":
    unittest.main()
