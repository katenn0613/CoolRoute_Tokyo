import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import networkx as nx
import osmnx as ox
import requests

from scripts.data_sources import OSMSource, SourceNotAvailableError
from scripts.demo_area import load_demo_area


def synthetic_osm_graph():
    graph = nx.MultiDiGraph(crs="EPSG:4326")
    graph.add_node(1, x=139.75, y=35.68)
    graph.add_node(2, x=139.751, y=35.681)
    graph.add_edge(1, 2, key=0, length=140.0)
    return graph


class OSMSourceTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.raw_directory = Path(self.temporary_directory.name)
        self.source = OSMSource(raw_directory=self.raw_directory)
        self.demo_area = load_demo_area()

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_prefers_a_real_graphml_cache_without_requesting_osm(self):
        ox.io.save_graphml(synthetic_osm_graph(), self.source.cache_path)
        self.source.metadata_path.write_text(
            json.dumps({"dataset": "OpenStreetMap", "synthetic": True}),
            encoding="utf-8",
        )

        with patch(
            "scripts.data_sources.osm_source.ox.graph.graph_from_bbox",
            side_effect=AssertionError("缓存存在时不应访问网络"),
        ):
            graph, origin = self.source.load_or_download(self.demo_area)

        self.assertEqual(origin, "cache")
        self.assertEqual(graph.number_of_nodes(), 2)
        self.assertEqual(graph.number_of_edges(), 1)

    def test_force_download_replaces_cache_and_records_provenance(self):
        old_graph = synthetic_osm_graph()
        old_graph.remove_node(2)
        ox.io.save_graphml(old_graph, self.source.cache_path)
        old_metadata = '{"dataset":"OpenStreetMap","retrievedAt":"synthetic-test-only-old"}\n'
        self.source.metadata_path.write_text(old_metadata, encoding="utf-8")

        with patch(
            "scripts.data_sources.osm_source.ox.graph.graph_from_bbox",
            return_value=synthetic_osm_graph(),
        ) as graph_from_bbox:
            graph, origin = self.source.load_or_download(
                self.demo_area,
                force_download=True,
            )

        self.assertEqual(origin, "download")
        self.assertEqual(graph.number_of_nodes(), 2)
        graph_from_bbox.assert_called_once_with(
            self.demo_area.osmnx_bbox,
            network_type="walk",
            simplify=True,
            retain_all=False,
        )
        cached_graph = ox.io.load_graphml(self.source.cache_path)
        self.assertEqual(cached_graph.number_of_nodes(), 2)
        archived_graphs = list(self.source.archive_directory.glob("*.graphml"))
        archived_metadata = list(self.source.archive_directory.glob("*.metadata.json"))
        self.assertEqual(len(archived_graphs), 1)
        self.assertEqual(len(archived_metadata), 1)
        archived_graph = ox.io.load_graphml(archived_graphs[0])
        self.assertEqual(archived_graph.number_of_nodes(), 1)
        self.assertEqual(archived_metadata[0].read_text(encoding="utf-8"), old_metadata)
        metadata = json.loads(self.source.metadata_path.read_text(encoding="utf-8"))
        self.assertEqual(metadata["dataset"], "OpenStreetMap")
        self.assertEqual(metadata["networkType"], "walk")
        self.assertEqual(metadata["demoArea"], self.demo_area.as_metadata())

    def test_network_failure_without_cache_creates_no_production_files(self):
        with patch(
            "scripts.data_sources.osm_source.ox.graph.graph_from_bbox",
            side_effect=requests.RequestException("synthetic network failure"),
        ):
            with self.assertRaises(SourceNotAvailableError):
                self.source.load_or_download(self.demo_area)

        self.assertFalse(self.source.cache_path.exists())
        self.assertFalse(self.source.metadata_path.exists())


if __name__ == "__main__":
    unittest.main()
