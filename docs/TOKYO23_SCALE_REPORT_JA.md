# CoolRoute Tokyo 東京23区スケール報告

## Coverage

- Road Graph: 111,574 Node / 327,240 directed Edge
- Green / Water: Tokyo23 Production Graph への付与完了
- Drinking Station: 東京23区内 567 Point
- Building Shade: 対象の大部分、672 mesh のうち 664 mesh（98.81%）
- Shade Scenario: 2026-09-23、09:00 / 12:00 / 15:00（Asia/Tokyo）

## Building Shade Data Quality

- 有効 Building: 1,742,604
- LOD2: 31,727
- 完全 LOD2 がないため LOD1 に建物単位で fallback: 1,710,877
- 高さ: Project PLATEAU Geometry の有効 Z 座標による `max(Z)-min(Z)`
- `measuredHeight`: QA 比較専用であり、Shade 計算には不使用

未処理 mesh は `53393624`、`53394615`、`53394616`、`53394640`、`53394641`、`53394642`、`53394643`、`53394644` です。この付近では Building Shade を過小評価する可能性があります。Road、Green、Water と Fastest Route はこの欠落の影響を受けません。

## Production Files

- `graph_tokyo23.json`: Graph Schema 1.1.0
- `shade_tokyo23.json`: Shade Schema 1.0.0、Road Edge ID Sidecar
- `drinking_stations_tokyo23.geojson`
- `environment_metadata_tokyo23.json`

Raw CityGML、ZIP、Shadow Polygon、中間 Geometry は GitHub Pages に配布しません。処理済み mesh の一時 Raw は検証後に削除します。

## Limitations

Building Shade は固定日時と PLATEAU 建築 Geometry によるモデル推定です。実測の日陰、気温、樹冠、天候、通行可否を表すものではありません。Heat Exposure Score は経路比較用のモデル指標であり、熱中症確率、医療リスク、医学的に検証された効果ではありません。
