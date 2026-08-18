from __future__ import annotations

import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path

import networkx as nx
import osmnx as ox

from .source_utils import BaseDataSource, SourceMetadata, SourceStatus
from .source_utils import SourceNotAvailableError
from scripts.demo_area import DemoArea, load_demo_area


class OSMSource(BaseDataSource):
    def __init__(self, raw_directory: str | Path = "data/raw/osm/") -> None:
        raw_path = Path(raw_directory)
        super().__init__(
            metadata=SourceMetadata(
                source_name="OpenStreetMap Walking Network",
                provider="OpenStreetMap contributors",
                source_page="https://www.openstreetmap.org/",
                raw_directory=raw_path,
                processed_directory=Path("data/processed/osm/"),
                status=SourceStatus.READY,
                required=True,
            ),
            expected_suffixes=(".graphml", ".json", ".osm", ".xml"),
        )
        self.cache_path = raw_path / "osm_walking.graphml"
        self.metadata_path = raw_path / "osm_walking.metadata.json"
        self.archive_directory = raw_path / "archive"

    def load_cache(self) -> nx.MultiDiGraph:
        if not self.cache_path.is_file() or not self.metadata_path.is_file():
            raise SourceNotAvailableError(
                "OSM GraphML 缓存和来源 metadata 必须同时存在："
                f"{self.cache_path}，{self.metadata_path}"
            )
        try:
            return ox.io.load_graphml(self.cache_path)
        except Exception as error:
            raise SourceNotAvailableError(f"无法读取 OSM GraphML 缓存：{self.cache_path}") from error

    def load_or_download(
        self,
        demo_area: DemoArea,
        force_download: bool = False,
    ) -> tuple[nx.MultiDiGraph, str]:
        if not force_download and self.cache_path.is_file():
            return self.load_cache(), "cache"
        return self.download(demo_area), "download"

    def download(self, demo_area: DemoArea | None = None) -> nx.MultiDiGraph:
        area = demo_area or load_demo_area()
        try:
            graph = ox.graph.graph_from_bbox(
                area.osmnx_bbox,
                network_type="walk",
                simplify=True,
                retain_all=False,
            )
        except Exception as error:
            raise SourceNotAvailableError(
                "无法从 OpenStreetMap/Overpass 获取 Demo Area 步行网络，"
                "且没有可用的完整本地缓存。"
            ) from error

        retrieved_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        provenance = {
            "dataset": "OpenStreetMap",
            "provider": "OpenStreetMap contributors",
            "sourcePage": "https://www.openstreetmap.org/",
            "license": "ODbL",
            "retrievedAt": retrieved_at,
            "spatialCoverage": {
                "demoArea": area.id,
                "requestedBoundingBox": list(area.bounding_box),
                "crs": "EPSG:4326",
            },
            "temporalCoverage": (
                "retrieval-time OSM snapshot; individual feature update times vary"
            ),
            "demoArea": area.as_metadata(),
            "networkType": "walk",
            "simplify": True,
            "retainAll": False,
            "osmnxVersion": ox.__version__,
            "networkxVersion": nx.__version__,
            "preprocessing": "OSMnx graph_from_bbox; simplified topology; largest weak component requested",
        }
        self._write_cache_atomically(graph, provenance)
        return graph

    def _write_cache_atomically(
        self,
        graph: nx.MultiDiGraph,
        provenance: dict[str, object],
    ) -> None:
        self.metadata.raw_directory.mkdir(parents=True, exist_ok=True)
        graph_handle = tempfile.NamedTemporaryFile(
            dir=self.metadata.raw_directory,
            prefix=".osm_walking.",
            suffix=".graphml",
            delete=False,
        )
        metadata_handle = tempfile.NamedTemporaryFile(
            dir=self.metadata.raw_directory,
            prefix=".osm_walking.",
            suffix=".json",
            mode="w",
            encoding="utf-8",
            delete=False,
        )
        graph_temp_path = Path(graph_handle.name)
        metadata_temp_path = Path(metadata_handle.name)
        archived_graph_path: Path | None = None
        archived_metadata_path: Path | None = None
        graph_handle.close()
        try:
            ox.io.save_graphml(graph, graph_temp_path)
            json.dump(provenance, metadata_handle, ensure_ascii=False, indent=2)
            metadata_handle.write("\n")
            metadata_handle.close()

            if self.cache_path.exists() or self.metadata_path.exists():
                self.archive_directory.mkdir(parents=True, exist_ok=True)
                archive_stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
                if self.cache_path.exists():
                    archived_graph_path = (
                        self.archive_directory / f"osm_walking.{archive_stamp}.graphml"
                    )
                    os.replace(self.cache_path, archived_graph_path)
                if self.metadata_path.exists():
                    archived_metadata_path = (
                        self.archive_directory
                        / f"osm_walking.{archive_stamp}.metadata.json"
                    )
                    os.replace(self.metadata_path, archived_metadata_path)

            os.replace(graph_temp_path, self.cache_path)
            os.replace(metadata_temp_path, self.metadata_path)
        except Exception:
            metadata_handle.close()
            graph_temp_path.unlink(missing_ok=True)
            metadata_temp_path.unlink(missing_ok=True)
            if archived_graph_path is not None and archived_graph_path.exists():
                self.cache_path.unlink(missing_ok=True)
                os.replace(archived_graph_path, self.cache_path)
            if archived_metadata_path is not None and archived_metadata_path.exists():
                self.metadata_path.unlink(missing_ok=True)
                os.replace(archived_metadata_path, self.metadata_path)
            raise
