from __future__ import annotations

from datetime import UTC, datetime
import json
import os
from pathlib import Path
import tempfile


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent,
        prefix=f".{path.name}.", suffix=".tmp", delete=False,
    )
    temporary = Path(handle.name)
    try:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        handle.close()
        os.replace(temporary, path)
    except Exception:
        handle.close()
        temporary.unlink(missing_ok=True)
        raise


class MeshProgress:
    """单个 Tokyo23 处理脚本的最小断点状态。"""

    def __init__(self, path: Path, *, pipeline: str, failure_path: Path | None = None) -> None:
        self.path = Path(path)
        self.failure_path = Path(failure_path) if failure_path else self.path.with_name(
            "failed_mesh_report.json"
        )
        if self.path.is_file():
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            if payload.get("pipeline") != pipeline:
                raise ValueError("进度文件属于其他 Pipeline。")
        else:
            payload = {"pipeline": pipeline, "completed": {}}
        failures = (
            json.loads(self.failure_path.read_text(encoding="utf-8"))
            if self.failure_path.is_file()
            else {"pipeline": pipeline, "failed": {}}
        )
        if failures.get("pipeline") != pipeline:
            raise ValueError("失败报告属于其他 Pipeline。")
        self.pipeline = pipeline
        self.completed: dict[str, dict] = payload.get("completed", {})
        self.failures: dict[str, dict] = failures.get("failed", {})

    def is_completed(self, mesh_id: str) -> bool:
        return mesh_id in self.completed

    def complete(self, mesh_id: str, result: dict) -> None:
        self.completed[mesh_id] = {
            **result,
            "completedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        }
        self.failures.pop(mesh_id, None)
        _write_json(self.path, {"pipeline": self.pipeline, "completed": self.completed})
        _write_json(self.failure_path, {"pipeline": self.pipeline, "failed": self.failures})

    def fail(self, mesh_id: str, error: str) -> None:
        self.failures[mesh_id] = {
            "error": str(error),
            "failedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        }
        _write_json(self.failure_path, {"pipeline": self.pipeline, "failed": self.failures})
