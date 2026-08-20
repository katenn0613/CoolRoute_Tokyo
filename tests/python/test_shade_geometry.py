from __future__ import annotations

from dataclasses import replace
import unittest

from scripts.shade.citygml import (
    ParsedBuilding,
    ParsedBuildingPart,
    ParsedSolid,
    ParsedSurface,
)
from scripts.shade.geometry import BuildingGeometryError, select_building_geometry


def surface(
    surface_id: str,
    surface_type: str,
    coordinates: tuple[tuple[float, float, float], ...],
) -> ParsedSurface:
    return ParsedSurface(surface_id, surface_type, coordinates, ())


def prism(lod: int, minimum_z: float, maximum_z: float, prefix: str) -> ParsedSolid:
    bottom = ((0, 0, minimum_z), (2, 0, minimum_z), (2, 2, minimum_z), (0, 2, minimum_z), (0, 0, minimum_z))
    top = ((0, 0, maximum_z), (0, 2, maximum_z), (2, 2, maximum_z), (2, 0, maximum_z), (0, 0, maximum_z))
    walls = (
        ((0, 0, minimum_z), (0, 0, maximum_z), (2, 0, maximum_z), (2, 0, minimum_z), (0, 0, minimum_z)),
        ((2, 0, minimum_z), (2, 0, maximum_z), (2, 2, maximum_z), (2, 2, minimum_z), (2, 0, minimum_z)),
        ((2, 2, minimum_z), (2, 2, maximum_z), (0, 2, maximum_z), (0, 2, minimum_z), (2, 2, minimum_z)),
        ((0, 2, minimum_z), (0, 2, maximum_z), (0, 0, maximum_z), (0, 0, minimum_z), (0, 2, minimum_z)),
    )
    return ParsedSolid(
        lod=lod,
        surfaces=(
            surface(f"{prefix}-ground", "GroundSurface", bottom),
            surface(f"{prefix}-roof", "RoofSurface", top),
            *(surface(f"{prefix}-wall-{index}", "WallSurface", ring) for index, ring in enumerate(walls)),
        ),
        referenced_surface_ids=(),
        unresolved_reference_ids=(),
    )


def empty_solid(lod: int) -> ParsedSolid:
    return ParsedSolid(lod, (), (), ())


def building(
    *,
    lod1: ParsedSolid | None = None,
    lod2: ParsedSolid | None = None,
    parts: tuple[ParsedBuildingPart, ...] = (),
    measured_height: float | None = 500,
) -> ParsedBuilding:
    return ParsedBuilding(
        id="synthetic-building",
        measured_height=measured_height,
        lod1=lod1 or empty_solid(1),
        lod2=lod2 or empty_solid(2),
        parts=parts,
        source_crs="http://www.opengis.net/def/crs/EPSG/0/6697",
        quality_flags=(),
    )


class BuildingGeometrySelectionTests(unittest.TestCase):
    def test_complete_lod2_wins_and_height_uses_all_building_parts(self):
        parts = (
            ParsedBuildingPart("part-a", prism(1, 10, 20, "a1"), prism(2, 10, 20, "a2")),
            ParsedBuildingPart("part-b", prism(1, 15, 40, "b1"), prism(2, 15, 42, "b2")),
        )

        selected = select_building_geometry(building(parts=parts, measured_height=999))

        self.assertEqual(selected.selected_lod, 2)
        self.assertEqual(selected.min_z, 10)
        self.assertEqual(selected.max_z, 42)
        self.assertEqual(selected.height, 32)
        self.assertEqual(tuple(solid.ground_z for solid in selected.solids), (10, 15))

    def test_incomplete_lod2_falls_back_the_whole_building_to_lod1(self):
        incomplete_lod2 = ParsedSolid(2, prism(2, 10, 20, "bad").surfaces[:1], (), ())

        selected = select_building_geometry(
            building(lod1=prism(1, 12, 24, "lod1"), lod2=incomplete_lod2)
        )

        self.assertEqual(selected.selected_lod, 1)
        self.assertEqual(len(selected.solids), 1)
        self.assertEqual(selected.quality_flags, ("lod1_fallback",))

    def test_one_incomplete_part_prevents_mixed_lod_selection(self):
        incomplete = ParsedSolid(2, (), (), ("missing-roof",))
        parts = (
            ParsedBuildingPart("part-a", prism(1, 10, 20, "a1"), prism(2, 10, 20, "a2")),
            ParsedBuildingPart("part-b", prism(1, 10, 30, "b1"), incomplete),
        )

        selected = select_building_geometry(building(parts=parts))

        self.assertEqual(selected.selected_lod, 1)
        self.assertTrue(all(solid.lod == 1 for solid in selected.solids))

    def test_measured_height_never_changes_formal_height_or_lod(self):
        original = building(lod2=prism(2, 8, 28, "lod2"), measured_height=-9999)

        sentinel = select_building_geometry(original)
        plausible = select_building_geometry(replace(original, measured_height=19.5))

        self.assertEqual(sentinel.height, 20)
        self.assertEqual(sentinel.selected_lod, plausible.selected_lod)
        self.assertEqual(sentinel.height, plausible.height)
        self.assertIsNone(sentinel.measured_height_difference)
        self.assertEqual(plausible.measured_height_difference, 0.5)

    def test_missing_complete_lod_is_a_hard_error(self):
        with self.assertRaisesRegex(BuildingGeometryError, "synthetic-building"):
            select_building_geometry(building())


if __name__ == "__main__":
    unittest.main()
