from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from io import BytesIO
import binascii
import json
import struct
import unittest
import zipfile

from scripts.data_sources.plateau_source import (
    PlateauEntry,
    PlateauSource,
    RemoteZipReader,
    official_plateau_entries,
)
from scripts.data_sources.source_utils import SourceNotAvailableError
from scripts.shade.config import default_shade_config


class ShadeConfigurationTests(unittest.TestCase):
    def test_default_configuration_exposes_fixed_reproducible_scenarios(self):
        config = default_shade_config(project_root=Path("/tmp/coolroute-project"))

        self.assertEqual(config.reference_date.isoformat(), "2026-09-23")
        self.assertEqual(config.timezone, "Asia/Tokyo")
        self.assertEqual(config.scenarios, ("09:00", "12:00", "15:00"))
        self.assertEqual(config.analysis_crs, "EPSG:6677")
        self.assertEqual(
            config.graph_path,
            Path("/tmp/coolroute-project/public/data/graph.json"),
        )
        self.assertEqual(
            config.output_path,
            Path("/tmp/coolroute-project/public/data/shade.json"),
        )


class PlateauSourceTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = TemporaryDirectory()
        self.raw_directory = Path(self.temporary_directory.name)
        self.entries = (
            PlateauEntry(
                mesh_id="inside",
                archive_path="udx/bldg/inside_bldg_6697_op.gml",
                bounds=(139.74, 35.67, 139.76, 35.69),
                compressed_size=100,
                uncompressed_size=400,
            ),
            PlateauEntry(
                mesh_id="outside",
                archive_path="udx/bldg/outside_bldg_6697_op.gml",
                bounds=(140.00, 36.00, 140.02, 36.02),
                compressed_size=100,
                uncompressed_size=400,
            ),
            PlateauEntry(
                mesh_id="not-building",
                archive_path="udx/tran/inside_tran_6697_op.gml",
                bounds=(139.74, 35.67, 139.76, 35.69),
                compressed_size=100,
                uncompressed_size=400,
            ),
        )

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_plan_entries_only_returns_intersecting_building_gml(self):
        source = PlateauSource(entries=self.entries, raw_directory=self.raw_directory)

        planned = source.plan_entries((139.744, 35.672, 139.771, 35.694))

        self.assertEqual(tuple(entry.mesh_id for entry in planned), ("inside",))
        self.assertEqual(planned[0].dataset_id, "plateau-13101-chiyoda-ku-2023")

    def test_fetch_entries_reuses_raw_cache_without_refetching(self):
        calls: list[tuple[str, str]] = []

        def fetcher(archive_url: str, archive_path: str) -> bytes:
            calls.append((archive_url, archive_path))
            return b"<core:CityModel>official fixture bytes</core:CityModel>"

        source = PlateauSource(
            entries=self.entries,
            raw_directory=self.raw_directory,
            entry_fetcher=fetcher,
        )
        planned = source.plan_entries((139.744, 35.672, 139.771, 35.694))

        first = source.fetch_entries(planned)
        second = source.fetch_entries(planned)

        self.assertEqual(first, second)
        self.assertEqual(len(calls), 1)
        self.assertEqual(first[0].read_bytes(), b"<core:CityModel>official fixture bytes</core:CityModel>")
        metadata = json.loads(first[0].with_suffix(".metadata.json").read_text(encoding="utf-8"))
        self.assertEqual(metadata["datasetId"], "plateau-13101-chiyoda-ku-2023")
        self.assertEqual(metadata["meshId"], "inside")
        self.assertEqual(metadata["archiveEntry"], "udx/bldg/inside_bldg_6697_op.gml")
        self.assertEqual(metadata["sizeBytes"], 55)

    def test_fetch_entries_uses_the_configured_official_archive(self):
        calls: list[tuple[str, str]] = []

        def fetcher(archive_url: str, archive_path: str) -> bytes:
            calls.append((archive_url, archive_path))
            return b"official Tokyo23 bytes"

        source = PlateauSource(
            entries=self.entries,
            raw_directory=self.raw_directory,
            entry_fetcher=fetcher,
            archive_url="https://example.invalid/official-tokyo23.zip",
        )

        source.fetch_entries((self.entries[0],))

        self.assertEqual(calls, [(
            "https://example.invalid/official-tokyo23.zip",
            "udx/bldg/inside_bldg_6697_op.gml",
        )])

    def test_failed_forced_fetch_keeps_previous_raw_file(self):
        source = PlateauSource(
            entries=self.entries,
            raw_directory=self.raw_directory,
            entry_fetcher=lambda _url, _path: b"stable official bytes",
        )
        planned = source.plan_entries((139.744, 35.672, 139.771, 35.694))
        cached_path = source.fetch_entries(planned)[0]

        def failing_fetcher(_archive_url: str, _archive_path: str) -> bytes:
            raise OSError("synthetic network failure")

        failing_source = PlateauSource(
            entries=self.entries,
            raw_directory=self.raw_directory,
            entry_fetcher=failing_fetcher,
        )

        with self.assertRaises(SourceNotAvailableError):
            failing_source.fetch_entries(planned, force_download=True)

        self.assertEqual(cached_path.read_bytes(), b"stable official bytes")
        self.assertEqual(tuple(self.raw_directory.glob("*.partial")), ())

    def test_remote_zip_reader_extracts_only_requested_entry(self):
        archive = BytesIO()
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
            output.writestr("udx/bldg/first.gml", b"first official bytes")
            output.writestr("udx/bldg/second.gml", b"second official bytes")
        payload = archive.getvalue()
        requested_ranges = []

        def read_range(start: int, end: int) -> bytes:
            requested_ranges.append((start, end))
            return payload[start : end + 1]

        reader = RemoteZipReader(len(payload), read_range)

        self.assertEqual(reader.read_entry("udx/bldg/second.gml"), b"second official bytes")
        self.assertLess(sum(end - start + 1 for start, end in requested_ranges), len(payload) * 2)

    def test_remote_zip_reader_supports_zip64_directory_and_entry_offsets(self):
        name = b"udx/bldg/53394500_bldg_6697_op.gml"
        content = b"official Tokyo23 CityGML fixture"
        checksum = binascii.crc32(content) & 0xFFFFFFFF
        local = struct.pack(
            "<4s5H3L2H", b"PK\x03\x04", 45, 0, 0, 0, 0,
            checksum, len(content), len(content), len(name), 0,
        ) + name + content
        zip64_extra = struct.pack("<HHQQQ", 0x0001, 24, len(content), len(content), 0)
        central = struct.pack(
            "<4s6H3L5H2L", b"PK\x01\x02", 45, 45, 0, 0, 0, 0,
            checksum, 0xFFFFFFFF, 0xFFFFFFFF, len(name), len(zip64_extra), 0,
            0, 0, 0, 0xFFFFFFFF,
        ) + name + zip64_extra
        central_offset = len(local)
        zip64_eocd_offset = central_offset + len(central)
        zip64_eocd = struct.pack(
            "<4sQ2H2L4Q", b"PK\x06\x06", 44, 45, 45, 0, 0,
            1, 1, len(central), central_offset,
        )
        locator = struct.pack("<4sLQL", b"PK\x06\x07", 0, zip64_eocd_offset, 1)
        eocd = struct.pack(
            "<4s4H2LH", b"PK\x05\x06", 0, 0, 0xFFFF, 0xFFFF,
            0xFFFFFFFF, 0xFFFFFFFF, 0,
        )
        payload = local + central + zip64_eocd + locator + eocd

        reader = RemoteZipReader(len(payload), lambda start, end: payload[start:end + 1])

        self.assertEqual(reader.read_entry(name.decode()), content)
        self.assertEqual(tuple(record.path for record in reader.list_records()), (name.decode(),))

    def test_official_manifest_contains_demo_area_building_meshes(self):
        planned = PlateauSource(entries=official_plateau_entries()).plan_entries(
            (139.744, 35.672, 139.771, 35.694)
        )

        self.assertEqual(len(planned), 12)
        self.assertEqual(planned[0].mesh_id, "53394509")
        self.assertEqual(planned[-1].mesh_id, "53394631")
        self.assertTrue(all(entry.compressed_size > 0 for entry in planned))


if __name__ == "__main__":
    unittest.main()
