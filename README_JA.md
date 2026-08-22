# CoolRoute Tokyo

[中文](README.md) | **日本語** | [English](README_EN.md)

[ライブデモ](https://katenn0613.github.io/CoolRoute_Tokyo/) · [データソース](docs/DATA_SOURCES.md) · [プロジェクト概要](docs/PROJECT_OVERVIEW_JA.md)

CoolRoute Tokyo は、東京の暑熱環境における徒歩ルートを比較するハッカソン向け Web アプリです。

- **最短ルート**：道路距離のみをコストとして計算；
- **バランスルート**：徒歩距離とモデル上の暑さ曝露を両立；
- **涼しさ優先ルート**：モデル上の暑さ曝露をより強く考慮。

アプリはブラウザ内で完結し、GitHub Pages から配信されます。オンラインバックエンド、データベース、外部 Routing API は使用しません。

> Heat Exposure Score（暑さ曝露スコア）はルート比較のためのモデル推定指標です。熱中症確率、医療リスク、医学的に検証されたリスク低減率ではありません。実際の環境はモデル推定と異なる場合があります。

## 現在の状態

- Production 対象範囲：東京23区；
- Road Graph：409,472 Node；
- 元の有向 Edge：1,206,772；
- 区境界の派生接続 Edge：22；
- Production Edge 合計：1,206,794；
- Building Shade：Project PLATEAU、671 source mesh；
- 日陰シナリオ：秋分日の 09:00、12:00、15:00；
- Browser Graph Schema：`1.1.0`；Shade Schema：`1.0.0`。

## 使い方

1. 地図をクリックして出発地を選択します；
2. もう一度クリックして目的地を選択します；
3. ブラウザが3種類のルートを計算し、同時に表示します；
4. Route Card で主表示ルートを切り替えます；
5. 09:00、12:00、15:00 の事前計算された建物日陰条件を Balanced/Coolest に反映できます。

地点は Tokyo23 の設定範囲内、かつ最寄りの歩行道路 Node から300 m以内である必要があります。

## モデル

```text
baseHeatExposure
= 0.7 × (1 - green_score)
+ 0.3 × water_penalty

shadeAwareHeatExposure
= 0.75 × baseHeatExposure
+ 0.25 × (1 - shade_score)

Fastest:  distance
Balanced: distance × (1 + 1 × shadeAwareHeatExposure)
Coolest:  distance × (1 + 3 × shadeAwareHeatExposure)
```

Fastest は Shade を参照しません。Balanced と Coolest は同じブラウザ内 Weighted Dijkstra を利用し、Weight Function のみを変更します。

## データとアーキテクチャ

- React + Vite + JavaScript；MapLibre GL JS；
- Web Worker 内のクライアントサイド Weighted Dijkstra；
- Road：OpenStreetMap walking network；
- Green：東京都公式「緑のオープンデータ（GISデータ）」；
- Water：Tokyowater Drinking Station；
- Building Shade：国土交通省 Project PLATEAU CityGML；
- GIS は開発・ビルド時にオフライン処理し、Production はバックエンドのない GitHub Pages 静的サイトです。

ブラウザが読むのは軽量バイナリ Graph、環境 metadata、GeoJSON、MVT のみです。Shapefile、GraphML、CityGML は実行時に処理しません。出典とライセンスは [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) を参照してください。

## ローカル実行

```bash
npm ci
npm run dev
npm test -- --run
npm run build -- --base /CoolRoute_Tokyo/
```

## 主なディレクトリ

```text
public/data/       ブラウザ用 Production Data
src/components/    React UI と MapLibre 操作
src/routing/       Graph、Snap、Dijkstra、ルート指標
src/shade/         Shade Sidecar / Layer
scripts/           オフライン GIS とデータ生成
tests/             テストと synthetic fixture
docs/              データ、手法、評価、開発段階の文書
```

## 既知の制約と今後の改善

- Tokyo23 Road Graph は当初、区ごとにダウンロード・簡略化されたため、行政区境界にトポロジーの切断が生じました。現在のハッカソン版では、99.8%以上の Node を含む12個の主要コンポーネントを、距離で選別した11組の双方向派生接続で結んでいます。残る8個の小規模な孤立コンポーネントは変更していません。
- 派生接続は主要コンポーネント間の短い切断を補うもので、現実の道路トポロジー全体を保証しません。接続位置と規則は [`topology_repair_tokyo23.json`](public/data/topology_repair_tokyo23.json) に記録しています。
- 今後は統一 Tokyo23 Polygon から OSM walking network を再生成し、一時的な区境界接続を正式な道路トポロジーに置き換えます。
- `green_score` は道路15 m Buffer 内の実緑被 Polygon 比率の代理値であり、木陰ではありません。
- Building Shade はオフライン幾何投影であり、実測日陰、道路温度、天気予報ではありません。Weather は Production に含まれません。
- 本プロジェクトは安全の保証、疾病予防、医学的効果を主張しません。

## データ真正性

東京の公式オープンデータを捏造しません。欠損は明示し、Production Data を synthetic データで置き換えません。Synthetic fixture はテスト専用です。
