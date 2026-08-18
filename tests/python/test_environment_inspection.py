import tempfile
import unittest
from pathlib import Path

import geopandas as gpd
from shapely.geometry import Point, Polygon

from scripts.demo_area import load_demo_area
from scripts.environment.config import GreenLayerDefinition
from scripts.environment.inspect_sources import (
    EnvironmentInspectionError,
    inspect_drinking_csv,
    inspect_green_layer,
)


class EnvironmentInspectionTests(unittest.TestCase):
    def setUp(self):
        self.demo_area = load_demo_area()
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary_directory.name)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_green_inspection_reports_schema_and_exact_demo_intersections(self):
        path = self.directory / "actual-green.geojson"
        frame = gpd.GeoDataFrame(
            {"category": ["inside", "outside"]},
            geometry=[
                Polygon([(139.75, 35.68), (139.751, 35.68), (139.751, 35.681)]),
                Polygon([(139.9, 35.8), (139.901, 35.8), (139.901, 35.801)]),
            ],
            crs="EPSG:4326",
        )
        frame.to_file(path, driver="GeoJSON")
        definition = GreenLayerDefinition(
            official_name="synthetic actual green",
            official_definition="synthetic-test-only actual green polygon",
            include=True,
            reason="测试明确表示实际绿色覆盖",
        )

        report = inspect_green_layer(path, definition, self.demo_area)

        self.assertEqual(report.feature_count, 2)
        self.assertEqual(report.demo_intersection_count, 1)
        self.assertEqual(report.crs, "EPSG:4326")
        self.assertEqual(report.geometry_types, ("Polygon",))
        self.assertEqual(report.fields, ("category",))
        self.assertTrue(report.include)

    def test_included_green_layer_rejects_non_polygon_geometry(self):
        path = self.directory / "points.geojson"
        gpd.GeoDataFrame(
            {"category": ["tree"]},
            geometry=[Point(139.75, 35.68)],
            crs="EPSG:4326",
        ).to_file(path, driver="GeoJSON")
        definition = GreenLayerDefinition(
            official_name="synthetic point",
            official_definition="synthetic-test-only point",
            include=True,
            reason="错误白名单",
        )

        with self.assertRaisesRegex(EnvironmentInspectionError, "Polygon"):
            inspect_green_layer(path, definition, self.demo_area)

    def test_semantically_undecided_green_layer_is_rejected(self):
        path = self.directory / "unknown.geojson"
        gpd.GeoDataFrame(
            {"category": ["unknown"]},
            geometry=[Polygon([(139.75, 35.68), (139.751, 35.68), (139.751, 35.681)])],
            crs="EPSG:4326",
        ).to_file(path, driver="GeoJSON")
        definition = GreenLayerDefinition(
            official_name="synthetic unknown",
            official_definition="语义不明确",
            include=None,
            reason="尚未决定",
        )

        with self.assertRaisesRegex(EnvironmentInspectionError, "语义"):
            inspect_green_layer(path, definition, self.demo_area)

    def test_drinking_csv_detects_cp932_fields_missing_values_and_demo_count(self):
        path = self.directory / "stations.csv"
        path.write_text(
            "緯度,経度,施設名称,所在地,水飲み栓設置場所,入場料等,タイプ\n"
            "35.6843,139.76355,テスト駅,千代田区,ホーム,有料,飲み口型\n"
            ",139.75,欠損点,千代田区,入口,,飲み口型\n"
            "35.8,139.9,区域外,東京都,入口,,ボトルディスペンサー型\n",
            encoding="cp932",
        )

        report = inspect_drinking_csv(path, self.demo_area)

        self.assertEqual(report.encoding, "cp932")
        self.assertEqual(report.row_count, 3)
        self.assertEqual(report.valid_coordinate_count, 2)
        self.assertEqual(report.missing_coordinate_count, 1)
        self.assertEqual(report.demo_area_count, 1)
        self.assertEqual(report.columns[0:2], ("緯度", "経度"))


if __name__ == "__main__":
    unittest.main()
