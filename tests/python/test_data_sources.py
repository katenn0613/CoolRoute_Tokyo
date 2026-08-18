from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.data_sources import (
    DrinkingStationSource,
    GreenSource,
    OSMSource,
    SourceNotAvailableError,
    SourceStatus,
)
from scripts.data_sources.source_utils import download_file


class DataSourceContractTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = TemporaryDirectory()
        self.raw_directory = Path(self.temporary_directory.name)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def sources(self):
        return (
            OSMSource(raw_directory=self.raw_directory),
            GreenSource(raw_directory=self.raw_directory),
            DrinkingStationSource(raw_directory=self.raw_directory),
        )

    def test_each_source_exposes_current_official_metadata_status(self):
        for source in self.sources():
            with self.subTest(source=source.metadata.source_name):
                self.assertTrue(source.metadata.source_name)
                self.assertTrue(source.metadata.provider)
                self.assertTrue(source.metadata.source_page.startswith("https://"))
                self.assertEqual(source.metadata.raw_directory, self.raw_directory)
                self.assertEqual(source.metadata.status, SourceStatus.READY)

    def test_download_file_uses_cache_and_records_sha256_without_reopening_network(self):
        destination = self.raw_directory / "official.csv"
        calls = []

        def opener(url):
            calls.append(url)
            return BytesIO(b"official,content\n")

        first = download_file("https://official.example/data.csv", destination, opener=opener)
        second = download_file("https://official.example/data.csv", destination, opener=opener)

        self.assertEqual(calls, ["https://official.example/data.csv"])
        self.assertFalse(first.from_cache)
        self.assertTrue(second.from_cache)
        self.assertEqual(first.sha256, "ae04426f41270101fa2c58a50536379bd869e5d5a7a78f39d1e4ed4798d1e1c2")
        self.assertEqual(destination.read_bytes(), b"official,content\n")

    def test_download_failure_does_not_leave_partial_or_replace_cached_raw(self):
        destination = self.raw_directory / "official.csv"
        destination.write_bytes(b"stable raw")

        class FailingStream(BytesIO):
            def read(self, size=-1):
                raise OSError("synthetic download failure")

        with self.assertRaises(SourceNotAvailableError):
            download_file(
                "https://official.example/data.csv",
                destination,
                force_download=True,
                opener=lambda _url: FailingStream(),
            )

        self.assertEqual(destination.read_bytes(), b"stable raw")
        self.assertEqual(list(self.raw_directory.glob("*.partial")), [])

    def test_environment_sources_expose_locked_official_resources(self):
        green = GreenSource(raw_directory=self.raw_directory)
        water = DrinkingStationSource(raw_directory=self.raw_directory)

        self.assertIn("green_teigisho.pdf", [resource.filename for resource in green.resources])
        self.assertEqual(
            water.resources[0].url,
            "https://www.opendata.metro.tokyo.lg.jp/suidou/R7/"
            "tokyowaterdrinkingstation_250917.csv",
        )

    def test_empty_raw_directory_is_reported_as_missing(self):
        for source in self.sources():
            with self.subTest(source=source.metadata.source_name):
                result = source.validate_raw_data()

                self.assertFalse(result.available)
                self.assertEqual(result.matched_files, ())
                self.assertIn("未找到", result.message)

    def test_expected_local_suffix_is_detected_without_modifying_the_file(self):
        csv_path = self.raw_directory / "official.csv"
        csv_content = "name,latitude,longitude\nsynthetic-test-only,0,0\n"
        csv_path.write_text(csv_content, encoding="utf-8")
        source = DrinkingStationSource(raw_directory=self.raw_directory)

        result = source.validate_raw_data()

        self.assertTrue(result.available)
        self.assertEqual(result.matched_files, (csv_path,))
        self.assertEqual(csv_path.read_text(encoding="utf-8"), csv_content)


if __name__ == "__main__":
    unittest.main()
