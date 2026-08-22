from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.data_sources.plateau_source import PlateauEntry
from scripts.tokyo23.progress import MeshProgress
from scripts.tokyo_core5.process_shade import (
    entries_requiring_processing,
    select_relevant_entries,
)


def entry(mesh_id, bounds):
    return PlateauEntry(
        mesh_id=mesh_id,
        archive_path=f"udx/bldg/{mesh_id}.gml",
        bounds=bounds,
        compressed_size=10,
        uncompressed_size=20,
        dataset_id="plateau-tokyo23ku",
    )


class Core5ShadeTests(unittest.TestCase):
    def test_only_meshes_intersecting_influence_bounds_are_selected(self):
        entries = (
            entry("inside", (139.70, 35.60, 139.72, 35.62)),
            entry("outside", (140.00, 36.00, 140.01, 36.01)),
        )

        selected = select_relevant_entries(entries, (139.69, 35.59, 139.73, 35.63), 500)

        self.assertEqual(tuple(item.mesh_id for item in selected), ("inside",))

    def test_completed_mesh_without_shard_is_reprocessed(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            progress = MeshProgress(root / "progress.json", pipeline="test")
            progress.complete("mesh-a", {"valid": 1})
            entries = (entry("mesh-a", (139.7, 35.6, 139.71, 35.61)),)

            pending = entries_requiring_processing(entries, progress, root / "shards")
            self.assertEqual(tuple(item.mesh_id for item in pending), ("mesh-a",))

            (root / "shards").mkdir()
            (root / "shards" / "mesh-a.json").write_text("{}", encoding="utf-8")
            self.assertEqual(entries_requiring_processing(entries, progress, root / "shards"), ())


if __name__ == "__main__":
    unittest.main()
