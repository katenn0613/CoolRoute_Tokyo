from io import BytesIO
import unittest
import zipfile

from scripts.data_sources.plateau_source import PlateauSource, RemoteZipReader
from scripts.tokyo23.config import load_tokyo23_config
from scripts.tokyo23.download_sources import discover_building_entries


class Tokyo23SourceTests(unittest.TestCase):
    def test_discovery_keeps_only_official_building_gml_mesh_entries(self):
        archive = BytesIO()
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
            output.writestr("root/udx/bldg/53394500_bldg_6697_2_op.gml", b"building")
            output.writestr("root/udx/tran/53394500_tran_6697_2_op.gml", b"road")
            output.writestr("root/udx/bldg/README.txt", b"not gml")
        payload = archive.getvalue()
        reader = RemoteZipReader(len(payload), lambda start, end: payload[start:end + 1])

        entries = discover_building_entries(reader, load_tokyo23_config())

        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].mesh_id, "53394500")
        self.assertEqual(entries[0].dataset_id, "plateau-tokyo23ku")
        self.assertEqual(entries[0].uncompressed_size, len(b"building"))
        self.assertEqual(
            PlateauSource(entries=entries).plan_entries((139.60, 35.50, 139.95, 35.85)),
            entries,
        )


if __name__ == "__main__":
    unittest.main()
