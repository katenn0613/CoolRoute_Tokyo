#!/usr/bin/env python3
from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import sys
from typing import Callable

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.tokyo_core5.progress import PipelineProgress


@dataclass(frozen=True)
class Stage:
    name: str
    outputs: tuple[Path, ...]
    action: Callable[[], dict | None]


def run_stages(stages: tuple[Stage, ...], progress: PipelineProgress) -> dict:
    for stage in stages:
        if progress.is_reusable(stage.name, stage.outputs):
            continue
        try:
            result = stage.action() or {}
            missing = tuple(path for path in stage.outputs if not path.is_file())
            if missing:
                raise RuntimeError(f"{stage.name} 完成后缺少输出：{', '.join(map(str, missing))}")
            progress.complete(stage.name, result)
        except Exception as error:
            progress.fail(stage.name, error)
            raise
    return {"completed": progress.completed, "failed": progress.failed}


def production_stages() -> tuple[Stage, ...]:
    from scripts.tokyo_core5.process_environment import run as environment
    from scripts.tokyo_core5.process_road import run as road
    from scripts.tokyo_core5.process_shade import run as shade
    from scripts.tokyo_core5.validate import run as validate

    return (
        Stage("road", (
            Path("data/processed/tokyo_core5/graph_schema_1_0_baseline.json"),
            Path("public/data/service_area_tokyo_core5.geojson"),
        ), road),
        Stage("environment", (
            Path("public/data/graph_tokyo_core5.json"),
            Path("public/data/environment_metadata_tokyo_core5.json"),
            Path("public/data/drinking_stations_tokyo_core5.geojson"),
        ), environment),
        Stage("shade", (Path("public/data/shade_tokyo_core5.json"),), shade),
        Stage("validate", (Path("data/processed/tokyo_core5/validation_report.json"),), validate),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="东京都心5区最小可恢复 Production Pipeline。")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--from-stage", choices=("road", "environment", "shade", "validate"))
    parser.add_argument("--retry-failed", action="store_true")
    args = parser.parse_args()
    progress = PipelineProgress()
    if args.status:
        print(json.dumps({"completed": progress.completed, "failed": progress.failed}, ensure_ascii=False, indent=2))
        return 0
    stages = production_stages()
    if args.from_stage:
        progress.reset_from(tuple(stage.name for stage in stages), args.from_stage)
    elif args.retry_failed:
        for stage in tuple(progress.failed):
            progress.failed.pop(stage, None)
        progress.save()
    print(json.dumps(run_stages(stages, progress), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
