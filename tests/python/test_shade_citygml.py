from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from scripts.shade.citygml import iter_buildings


FIXTURE = Path("tests/python/fixtures/plateau_buildings.gml")


class CityGmlParserTests(unittest.TestCase):
    def buildings(self):
        return {building.id: building for building in iter_buildings(FIXTURE)}

    def test_parser_reads_inline_lod_geometry_and_source_crs(self):
        building = self.buildings()["synthetic-inline"]

        self.assertEqual(building.source_crs, "http://www.opengis.net/def/crs/EPSG/0/6697")
        self.assertEqual(building.measured_height, 10.0)
        self.assertEqual(len(building.lod2.surfaces), 1)
        self.assertEqual(building.lod2.surfaces[0].exterior_ring[0], (35.68, 139.75, 20.0))

    def test_parser_resolves_required_building_local_xlinks(self):
        building = self.buildings()["synthetic-xlink"]

        self.assertEqual(building.lod2.unresolved_reference_ids, ())
        self.assertEqual(tuple(surface.id for surface in building.lod2.surfaces), ("xlink-roof",))
        self.assertEqual(building.lod2.surfaces[0].surface_type, "RoofSurface")

    def test_parser_preserves_building_parts_and_polygon_holes(self):
        building = self.buildings()["synthetic-parts"]

        self.assertEqual(tuple(part.id for part in building.parts), ("part-a", "part-b"))
        self.assertEqual(len(building.parts[0].lod2.surfaces[0].interior_rings), 1)
        self.assertEqual(building.parts[1].lod2.surfaces[0].exterior_ring[0][2], 42.0)

    def test_parser_reports_missing_required_xlink_without_using_measured_height(self):
        building = self.buildings()["synthetic-fallback"]

        self.assertEqual(building.measured_height, -9999.0)
        self.assertEqual(len(building.lod1.surfaces), 1)
        self.assertEqual(building.lod2.surfaces, ())
        self.assertEqual(building.lod2.unresolved_reference_ids, ("missing-surface",))

    def test_parser_inherits_city_model_envelope_crs(self):
        xml = '''<?xml version="1.0" encoding="UTF-8"?>
<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0"
 xmlns:bldg="http://www.opengis.net/citygml/building/2.0"
 xmlns:gml="http://www.opengis.net/gml">
 <gml:boundedBy><gml:Envelope srsName="http://www.opengis.net/def/crs/EPSG/0/6697"/></gml:boundedBy>
 <core:cityObjectMember><bldg:Building gml:id="global-crs"/></core:cityObjectMember>
</core:CityModel>'''
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "global-crs.gml"
            path.write_text(xml, encoding="utf-8")

            building = next(iter_buildings(path))

        self.assertEqual(building.source_crs, "http://www.opengis.net/def/crs/EPSG/0/6697")


if __name__ == "__main__":
    unittest.main()
