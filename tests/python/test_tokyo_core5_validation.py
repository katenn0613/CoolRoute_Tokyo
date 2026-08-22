from pathlib import Path
from tempfile import TemporaryDirectory
import json
import unittest

from scripts.tokyo_core5.validate import validate_payloads


class Core5ValidationTests(unittest.TestCase):
    def test_missing_ward_and_oversized_graph_block_release(self):
        graph = {
            "metadata": {"graphVersion": "1.1.0", "edgeCount": 1, "nodeCount": 2},
            "nodes": {"1": {"id": "1", "lon": 139.7, "lat": 35.6}, "2": {"id": "2", "lon": 139.71, "lat": 35.61}},
            "edges": [{"id": "1:2:0", "source": "1", "target": "2", "length": 10, "geometry": [[139.7, 35.6], [139.71, 35.61]], "green_score": 0.2, "water_penalty": 0.3}],
        }
        shade = {
            "metadata": {"schemaVersion": "1.0.0", "roadGraphSchemaVersion": "1.1.0", "scenarios": ["09:00", "12:00", "15:00"], "edgeCount": 1},
            "edgeShadeScores": {"1:2:0": [0.1, 0.2, 0.3]},
        }
        service = {
            "type": "FeatureCollection",
            "features": [{"properties": {"wardIds": ["13101"]}, "geometry": {"type": "Polygon", "coordinates": []}}],
        }
        stations = {"type": "FeatureCollection", "features": []}
        with TemporaryDirectory() as directory:
            root = Path(directory)
            paths = {}
            for name, payload in {"graph": graph, "shade": shade, "service": service, "stations": stations, "environment": {}}.items():
                path = root / f"{name}.json"
                path.write_text(json.dumps(payload), encoding="utf-8")
                paths[name] = path

            with self.assertRaisesRegex(ValueError, "固定五区"):
                validate_payloads(paths, maximum_graph_bytes=10_000)

            service["features"][0]["properties"]["wardIds"] = ["13101", "13102", "13103", "13104", "13105"]
            paths["service"].write_text(json.dumps(service), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "文件大小"):
                validate_payloads(paths, maximum_graph_bytes=10)


if __name__ == "__main__":
    unittest.main()
