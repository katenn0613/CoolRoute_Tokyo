"""检查 M4 真实 Raw Schema，并输出进入 Enrichment 前的门禁报告。"""

from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime
import json
import hashlib
from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.demo_area import load_demo_area
from scripts.environment.config import GreenLayerDefinition
from scripts.environment.inspect_sources import inspect_drinking_csv, inspect_green_layer


GREEN_LAYERS = (
    (
        Path("data/processed/green/extracted/03/03_樹林地/樹林地.shp"),
        GreenLayerDefinition(
            official_name="樹林地",
            official_definition="300㎡以上の一団の樹林地",
            include=True,
            reason="官方定义明确表示实际成片树林，纳入实际绿色覆盖 Polygon。",
        ),
    ),
    (
        Path("data/processed/green/extracted/03/03_樹林地/崖線の樹林地.shp"),
        GreenLayerDefinition(
            official_name="崖線の樹林地",
            official_definition="「樹林地」范围中在崖线范围内确认的树林",
            include=True,
            reason="官方定义明确表示已确认树林；union 会消除其与樹林地的重复。",
        ),
    ),
    (
        Path("data/processed/green/extracted/03/03_樹林地/自治体管理の樹林地.shp"),
        GreenLayerDefinition(
            official_name="自治体管理の樹林地",
            official_definition="不包含于公园、绿地或保存树林等范围、由自治体管理的树林",
            include=True,
            reason="官方定义明确表示实际树林；当前 Demo 无相交要素也保留透明决策记录。",
        ),
    ),
    (
        Path("data/processed/green/extracted/10/10_公共施設の緑/公共施設の緑.shp"),
        GreenLayerDefinition(
            official_name="公共施設の緑",
            official_definition="公共设施区域内以航空照片为基础提取制作的绿色覆盖",
            include=True,
            reason="官方定义明确表示从航空照片提取的实际绿色覆盖 Polygon。",
        ),
    ),
)

EXCLUDED_CATEGORIES = (
    {
        "officialName": "公園・緑地等、自然公園",
        "officialDefinition": "公园、庭园或自然公园等区域",
        "include": False,
        "reason": "区域边界不等于实际绿色覆盖。",
    },
    {
        "officialName": "都市計画法・都市緑地法等に基づく緑、条例等に基づく緑",
        "officialDefinition": "规划、法规或条例指定区域",
        "include": False,
        "reason": "法规/规划区域不等于实际绿色覆盖。",
    },
    {
        "officialName": "水系",
        "officialDefinition": "河川、运河、水道、湖沼、干潟、湧水",
        "include": False,
        "reason": "水系不是当前 green_score 定义中的实际绿色覆盖 Polygon。",
    },
    {
        "officialName": "街路樹",
        "officialDefinition": "Point 或 Line 表达的街路树",
        "include": False,
        "reason": "Point/Line 不混入当前 Polygon coverage ratio。",
    },
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    demo_area = load_demo_area()
    extraction_manifest = Path("data/processed/green/extraction_manifest.json")
    if not extraction_manifest.is_file():
        raise RuntimeError("缺少 Green extraction_manifest.json，禁止 Schema Inspection。")
    green_reports = [
        asdict(inspect_green_layer(path, definition, demo_area))
        for path, definition in GREEN_LAYERS
    ]
    drinking = asdict(
        inspect_drinking_csv(
            "data/raw/drinking_station/tokyowaterdrinkingstation_250917.csv",
            demo_area,
        )
    )
    payload = {
        "generatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "demoArea": demo_area.as_metadata(),
        "green": {
            "dataset": "緑のオープンデータ（GISデータ）",
            "provider": "東京都都市整備局 都市づくり政策部緑地景観課",
            "extractionManifestSha256": sha256(extraction_manifest),
            "layers": green_reports,
            "explicitlyExcludedCategories": EXCLUDED_CATEGORIES,
        },
        "water": {
            "dataset": "Tokyowater Drinking Station 一覧",
            "provider": "東京都水道局",
            **drinking,
        },
    }
    output = Path("data/processed/environment/schema_inspection.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"Schema Inspection Report：{output}")


if __name__ == "__main__":
    main()
