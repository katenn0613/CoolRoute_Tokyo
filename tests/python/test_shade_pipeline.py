from __future__ import annotations

from dataclasses import replace
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from scripts.build_shade_data import run_pipeline
from scripts.shade.config import default_shade_config
from tests.python.test_shade_geometry import building, prism


class _FixtureSource:
    def __init__(self, path: Path):
        self.path = path

    def plan_entries(self, _bounds):
        return (object(),)

    def fetch_entries(self, _entries, force_download=False):
        return (self.path,)


def _geographic_building():
    source = prism(2, 5, 20, "pipeline")
    surfaces = tuple(
        replace(
            item,
            exterior_ring=tuple(
                (35.680 + x / 10000, 139.750 + y / 10000, z)
                for x, y, z in item.exterior_ring
            ),
        )
        for item in source.surfaces
    )
    return building(lod2=replace(source, surfaces=surfaces), measured_height=-9999)


class ShadePipelineTests(unittest.TestCase):
    def test_geometry_stage_does_not_project_shadows(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            config = default_shade_config(root)
            config.graph_path.parent.mkdir(parents=True)
            graph = {
                "metadata": {
                    "graphVersion": "1.1.0",
                    "generatedAt": "graph-baseline",
                    "boundingBox": [139.749, 35.679, 139.752, 35.682],
                    "demoArea": {"center": [139.7505, 35.6805]},
                },
                "edges": [{"id": "u:v:0", "source": "u", "target": "v", "geometry": [[139.75, 35.68], [139.751, 35.681]]}],
            }
            config.graph_path.write_text(json.dumps(graph), encoding="utf-8")
            raw_path = root / "synthetic.gml"
            raw_path.write_text("synthetic fixture placeholder", encoding="utf-8")

            with (
                patch("scripts.build_shade_data.iter_buildings", return_value=iter((_geographic_building(),))),
                patch("scripts.build_shade_data.project_building_shadow", side_effect=AssertionError("geometry stage projected shadows")),
            ):
                report = run_pipeline(
                    config,
                    _FixtureSource(raw_path),
                    publish=False,
                    stage="geometry",
                )

            self.assertEqual(report.valid_building_count, 1)
            self.assertFalse(report.published)

    def test_pipeline_builds_sidecar_without_mutating_graph(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            config = default_shade_config(root)
            config.graph_path.parent.mkdir(parents=True)
            graph = {
                "metadata": {
                    "graphVersion": "1.1.0",
                    "generatedAt": "graph-baseline",
                    "boundingBox": [139.749, 35.679, 139.752, 35.682],
                    "demoArea": {"center": [139.7505, 35.6805]},
                },
                "nodes": {},
                "edges": [
                    {
                        "id": "u:v:0",
                        "source": "u",
                        "target": "v",
                        "geometry": [[139.7498, 35.6801], [139.7503, 35.6801]],
                    }
                ],
            }
            config.graph_path.write_text(json.dumps(graph), encoding="utf-8")
            raw_path = root / "synthetic.gml"
            raw_path.write_text("synthetic fixture placeholder", encoding="utf-8")
            before = config.graph_path.read_bytes()

            with patch(
                "scripts.build_shade_data.iter_buildings",
                return_value=iter((_geographic_building(),)),
            ):
                report = run_pipeline(config, _FixtureSource(raw_path), publish=True)

            self.assertEqual(config.graph_path.read_bytes(), before)
            self.assertTrue(config.output_path.is_file())
            payload = json.loads(config.output_path.read_text(encoding="utf-8"))
            self.assertEqual(tuple(payload["metadata"]["scenarios"]), ("09:00", "12:00", "15:00"))
            self.assertEqual(set(payload["edgeShadeScores"]), {"u:v:0"})
            self.assertEqual(report.edge_count, 1)
            self.assertEqual(report.valid_building_count, 1)


if __name__ == "__main__":
    unittest.main()
