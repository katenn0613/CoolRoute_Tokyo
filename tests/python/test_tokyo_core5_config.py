from pathlib import Path
from tempfile import TemporaryDirectory
import json
import unittest

from scripts.tokyo_core5.config import CORE5_WARD_IDS, load_core5_config


class Core5ConfigTests(unittest.TestCase):
    def test_config_contains_exactly_the_fixed_five_wards(self):
        config = load_core5_config()

        self.assertEqual(tuple(ward.id for ward in config.wards), CORE5_WARD_IDS)
        self.assertEqual(config.id, "tokyo_core_5_wards")
        self.assertEqual(config.name, "東京都心5区")

    def test_missing_or_duplicate_ward_is_rejected(self):
        source = json.loads(Path("config/tokyo_core5_area.json").read_text(encoding="utf-8"))
        source["wards"][-1]["id"] = source["wards"][0]["id"]
        with TemporaryDirectory() as directory:
            path = Path(directory) / "core5.json"
            path.write_text(json.dumps(source), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "固定五区"):
                load_core5_config(path)


if __name__ == "__main__":
    unittest.main()
