from pathlib import Path
from tempfile import TemporaryDirectory
import json
import unittest

from scripts.tokyo23.config import load_tokyo23_config


class Tokyo23ConfigTests(unittest.TestCase):
    def test_production_config_exposes_23_unique_wards_and_official_plateau(self):
        config = load_tokyo23_config()

        self.assertEqual(len(config.wards), 23)
        self.assertEqual(len({ward.id for ward in config.wards}), 23)
        self.assertEqual(config.plateau.dataset_id, "plateau-tokyo23ku")
        self.assertEqual(config.plateau.dataset_year, 2020)
        self.assertEqual(config.storage_limit_bytes, 50 * 1024 ** 3)

    def test_duplicate_ward_configuration_is_rejected(self):
        source = json.loads(Path("config/tokyo23_area.json").read_text(encoding="utf-8"))
        source["wards"][-1]["id"] = source["wards"][0]["id"]
        with TemporaryDirectory() as directory:
            path = Path(directory) / "tokyo23.json"
            path.write_text(json.dumps(source), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "23 个唯一"):
                load_tokyo23_config(path)


if __name__ == "__main__":
    unittest.main()
