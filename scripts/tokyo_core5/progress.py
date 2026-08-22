from __future__ import annotations

from datetime import UTC, datetime
import json
import os
from pathlib import Path
import tempfile


def _write(path: Path, payload: dict) -> None:
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


class PipelineProgress:
    def __init__(self, path: Path = Path("data/processed/tokyo_core5/progress.json")) -> None:
        self.path = Path(path)
        payload = json.loads(self.path.read_text(encoding="utf-8")) if self.path.is_file() else {}
        self.completed = payload.get("completed", {})
        self.failed = payload.get("failed", {})

    def save(self) -> None:
        _write(self.path, {
            "pipeline": "tokyo-core5-production",
            "completed": self.completed,
            "failed": self.failed,
        })

    def is_reusable(self, stage: str, outputs: tuple[Path, ...]) -> bool:
        return stage in self.completed and all(path.is_file() for path in outputs)

    def complete(self, stage: str, result: dict) -> None:
        self.completed[stage] = {
            **result,
            "completedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        }
        self.failed.pop(stage, None)
        self.save()

    def fail(self, stage: str, error: Exception) -> None:
        self.completed.pop(stage, None)
        self.failed[stage] = {
            "error": str(error),
            "failedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        }
        self.save()

    def reset_from(self, stage_names: tuple[str, ...], start: str) -> None:
        index = stage_names.index(start)
        for stage in stage_names[index:]:
            self.completed.pop(stage, None)
            self.failed.pop(stage, None)
        self.save()

