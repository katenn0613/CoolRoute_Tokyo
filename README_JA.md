# CoolRoute Tokyo

[![中文](https://img.shields.io/badge/README-中文-d9d9d9)](README.md)
[![日本語](https://img.shields.io/badge/README-日本語-16794b)](README_JA.md)
[![English](https://img.shields.io/badge/README-English-d9d9d9)](README_EN.md)

CoolRoute Tokyo は、東京の高温環境における徒歩経路を比較するハッカソン向け Web アプリです。**Fastest Route**、**Balanced Route**、**Coolest Route** を提示し、歩行時間と非医療的なモデル推定値である **Heat Exposure Score**（暑さ曝露スコア）のトレードオフを確認できます。

> **プロジェクト状況：** M11 Production の対象は、連続性と完全な検証が可能な**東京都心5区**（千代田区、中央区、港区、新宿区、文京区）です。Road、Green、Water、Building Shade は同一のサービス範囲を使用します。Browser Graph Schema は `1.1.0` のままで、Production はオンラインバックエンドを持たない完全な静的アプリです。

`?dataset=tokyo23-route-a` では、遠隔ブランチから統合した Tokyo23 Binary/Worker/MVT Runtime を実験的に確認できます。実験 Graph は 409,472 Node、1,206,772 Directed Edge、20 Weak Component を含み、Component 間の OD は到達不能です。約288MBの構築元 JSON はコミットされていないため、Production の既定値にはせず、初期化失敗時は Core5 に自動フォールバックします。

## Live Demo

<https://katenn0613.github.io/CoolRoute_Tokyo/>

都心5区のデータ品質と制限については、[TOKYO_CORE5_SCALE_REPORT_JA](docs/TOKYO_CORE5_SCALE_REPORT_JA.md) を参照してください。

## アーキテクチャ

- 静的フロントエンド：React + Vite + JavaScript
- 地図：MapLibre GL JS
- デプロイ：GitHub Pages Artifact Workflow
- 経路探索：ブラウザ内 JavaScript
- GIS 前処理：開発・ビルド段階のみで実行するオフライン Python
- Production バックエンド：なし
- データベース：なし

デプロイ後のアプリは、GitHub Pages からバージョン管理された Road Graph と環境データを JSON / GeoJSON として読み込みます。独自の Routing API や常時稼働サーバーは使用しません。

## 3つの経路

- **最短ルート（fastest）：** 道路距離の合計を最小化します。
- **バランスルート（balanced）：** 距離とモデル上の暑さ曝露を折衷します。
- **涼しさ優先ルート（coolest）：** 追加距離を許容し、低いモデル曝露により大きな重みを与えます。

3つの経路は同じ Weighted Dijkstra 実装で計算され、実際の Road Edge Geometry に沿って地図上に同時表示されます。

## ローカル実行

```bash
npm install
npm run dev
```

テストと Production Build：

```bash
npm test -- --run
npm run build
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m unittest discover -s tests/python -v
```

GitHub Project Pages の Subpath を使った Artifact 検証：

```bash
npm run build -- --base /CoolRoute_Tokyo/
node scripts/validate_pages_build.mjs --dist dist --base-path /CoolRoute_Tokyo/
```

Production Workflow はリポジトリ名をハードコードせず、`actions/configure-pages` が出力する `base_path` を使用します。`npm run preview` はローカル確認専用で、Production が依存するサーバーではありません。

M7 の経路評価を再生成する場合：

```bash
npm run evaluate:routes
```

この評価は Random Seed `20260821` を固定し、Routing Algorithm、Exposure Formula、Weight、Lambda、Production Graph を変更しません。

東京都心5区の Production Data を再生成・再開する場合：

```bash
.venv/bin/python scripts/tokyo_core5/run_pipeline.py --status
.venv/bin/python scripts/tokyo_core5/run_pipeline.py
.venv/bin/python scripts/tokyo_core5/run_pipeline.py --from-stage shade
```

Core5 Pipeline は Road → Environment → Shade → Validate の順で実行します。Shade は mesh ごとに結果と進捗を保存し、検証に成功した Raw GML を直ちに削除します。中断後の再開は削除済み Raw ファイルに依存しません。

## 対象エリア

Production は東京都心5区を使用します。中心は `[139.7421134, 35.6806304]`、行政区 Union の Bounding Box は `[139.6732748, 35.6230363, 139.7931527, 35.7359098]` で、唯一の正式設定は `config/tokyo_core5_area.json` です。

ブラウザは `service_area_tokyo_core5.geojson` も読み込むため、出発地と目的地は単なる矩形ではなく、実際の5区 Union Polygon 内に制限されます。旧 Demo は回帰用に残します。欠損していた旧 Tokyo23 JSON は Pages Asset から除外し、新しい Binary/MVT は明示的な実験 Runtime としてのみ使用します。

## リポジトリ構成

```text
.
├── .github/workflows/    # GitHub Pages の Build / Deploy
├── data/
│   ├── processed/        # 開発段階の GIS 派生データ
│   └── raw/              # 出典記録付きのローカル Raw Data
├── docs/                 # 設計、評価、データ品質文書
├── evaluation/           # M7 の OD 別結果と集計
├── public/data/          # ブラウザが読む静的 Production Assets
├── scripts/              # オフライン OSM / GIS 処理と検証
├── src/
│   ├── components/       # React UI
│   ├── config/           # 地図、範囲、データソース設定
│   ├── routing/          # ブラウザ内 Graph / Routing
│   └── utils/            # 共通 Utility
├── tests/                # 決定論的テストと synthetic fixture
├── AGENTS.md             # リポジトリの開発規則
└── PROJECT_SPEC.md       # 製品範囲とデータ契約
```

## データと指標

Production は次の実データを使用します。

- OpenStreetMap の歩行道路ネットワーク
- 東京都「緑のオープンデータ（GISデータ）」の実緑被覆 Polygon ホワイトリスト
- 東京都水道局 Tokyowater Drinking Station
- 国土交通省 Project PLATEAU 東京23区 2020 の公式 Building CityGML のうち、都心5区の影響範囲に交差する mesh

公式データを捏造・補完して Production Data として扱うことは禁止されています。出典、ライセンス、取得状況、処理内容は [DATA_SOURCES](docs/DATA_SOURCES.md) に記録しています。Synthetic Data は明示されたテスト fixture に限られます。

`green_score` は道路 15m Buffer 内の実緑被覆 Polygon 比率の代理値であり、樹冠の日陰、実測路面温度、医療リスクではありません。`water_penalty` は最寄りの公式 Drinking Station Point までの距離に基づく指標で、経路がその地点を実際に通過することを意味しません。

## Heat Exposure Model

M5 Base Exposure：

```text
baseHeatExposure
= 0.7 × (1 - green_score)
+ 0.3 × water_penalty
```

M10.5 Shade-aware Exposure：

```text
shadeAwareHeatExposure
= 0.75 × baseHeatExposure
+ 0.25 × (1 - shade_score)
```

Fastest の Cost は常に道路距離のみです。Balanced と Coolest は同じ Weighted Dijkstra で、それぞれ lambda 1 と 3 を使用します。09:00、12:00、15:00 の Shade Context を切り替えると、Balanced / Coolest のみを再計算します。

**Average Heat Exposure Score** は単位距離あたりの長さ加重平均です。**Modelled Exposure Load** は `Edge Length × Heat Exposure Score` の累積代理量です。この2つは別の指標です。

Heat Exposure Score / Heat Exposure Index は経路比較のためのモデル推定値です。熱中症確率、医療リスク、医学的に検証されたリスク低減率ではありません。

## 評価

M7 は Random Seed `20260821` を使い、Fastest Route Distance ごとに90組の有向 OD を抽出しました。

- 400–1000m：30組
- 1000–2000m：30組
- 2000–3500m：30組

Trade-off の結果によるサンプル選別は行っていません。旧 Demo Area と当時のモデル条件では、Average Heat Exposure と Modelled Exposure Load がともに低下したサンプルは Balanced 55.6%、Coolest 61.1% で、3経路すべてが同一だった割合は38.9%でした。この結果は東京全域や現在のCore5全体へ一般化できず、医療効果を示すものでもありません。

評価結果は [evaluation_results.json](evaluation/evaluation_results.json)、[evaluation_summary.json](evaluation/evaluation_summary.json)、[EVALUATION_SUMMARY_JA](docs/EVALUATION_SUMMARY_JA.md) を参照してください。

## Building Shade

Building Height は Project PLATEAU の LOD Geometry Z Range のみから計算します。完全な LOD2 を優先し、不完全な場合は整棟 LOD1 にフォールバックします。`measuredHeight` は QA 専用で Shade 計算には使用しません。

固定日 `2026-09-23`（Asia/Tokyo）の 09:00、12:00、15:00 をオフラインで事前計算します。ブラウザは CityGML や Shadow Polygon を処理せず、軽量な `shade_tokyo_core5.json` Sidecar だけを読み込みます。

Core5 Production の統計：

- Road Node：60,983
- 有向 Road Edge：181,858
- Weak Component：1
- PLATEAU mesh：126 / 126
- 有効 Building：293,663
- LOD2 Building：29,561
- LOD1 fallback：264,102
- Shade Sidecar：約7.9MB、全181,858 Edge ID を収録

この Shade Score は建物 Geometry による固定日時の推定日陰であり、実測日陰、樹木の日陰、気温低下、天候、医療リスクを表しません。

## Production Deployment

GitHub Actions は `main` への Push 後、JavaScript Test、Vite Subpath Build、Production Data 検証、GitHub Pages Artifact Upload、Deploy を実行します。`dist/` や Raw GIS は Git History に含めません。

Production Runtime は HTML、JavaScript、CSS、JSON、GeoJSON の静的ファイルだけで構成され、Backend、Database、Remote Routing API、Weather API を使用しません。

## 現在の制限

- 対象は東京23区全域ではなく、連続性とブラウザ性能を優先した東京都心5区です。
- OSM の道路属性と通行可否はコミュニティデータの完全性・更新時点に依存します。
- Green / Water / PLATEAU は公式データの調査時点と空間的完全性に依存します。
- Building Shade は固定日時の幾何モデルで、リアルタイムの天候、樹木の日陰、地形、材質、放射強度を含みません。
- 実際の環境はモデル推定と異なる場合があります。
