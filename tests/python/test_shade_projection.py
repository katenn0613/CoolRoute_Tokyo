from __future__ import annotations

import unittest

from scripts.shade.geometry import select_building_geometry
from scripts.shade.projection import project_building_shadow, project_vertex
from scripts.shade.solar import SolarPosition
from tests.python.test_shade_geometry import building, prism


class ShadowProjectionTests(unittest.TestCase):
    def test_ten_meter_vertex_at_45_degrees_casts_ten_meter_shadow(self):
        projected = project_vertex(0, 0, 10, 0, SolarPosition(90, 45))

        self.assertAlmostEqual(projected[0], -10, places=9)
        self.assertAlmostEqual(projected[1], 0, places=9)

    def test_building_shadow_is_valid_and_excludes_ground_footprint(self):
        selected = select_building_geometry(
            building(lod2=prism(2, 0, 10, "box"), measured_height=None)
        )

        result = project_building_shadow(selected, SolarPosition(135, 45))

        self.assertTrue(result.shadow.is_valid)
        self.assertGreater(result.shadow.area, 0)
        self.assertAlmostEqual(result.shadow.intersection(result.footprint).area, 0, places=8)

    def test_lower_solar_elevation_produces_larger_shadow(self):
        selected = select_building_geometry(
            building(lod2=prism(2, 0, 10, "box"), measured_height=None)
        )

        low = project_building_shadow(selected, SolarPosition(180, 30)).shadow
        high = project_building_shadow(selected, SolarPosition(180, 60)).shadow

        self.assertGreater(low.area, high.area)

    def test_non_positive_solar_elevation_is_rejected(self):
        selected = select_building_geometry(
            building(lod2=prism(2, 0, 10, "box"), measured_height=None)
        )

        with self.assertRaisesRegex(ValueError, "太阳高度角"):
            project_building_shadow(selected, SolarPosition(90, 0))


if __name__ == "__main__":
    unittest.main()
