# 東京都心5区 Production Data レポート

## 対象範囲

Production の対象は、千代田区・中央区・港区・新宿区・文京区です。5 区の公式 OSM 行政境界 Polygon を先に union し、同じ連続 Polygon から Road Graph と Service Area を生成しました。

| 項目 | 結果 |
|---|---:|
| Road Node | 60,983 |
| 有向 Road Edge | 181,858 |
| Weak Component | 1 |
| 平均 Edge Length | 34.285 m |
| 最大 Edge Length | 3,504.763 m |
| Enriched Graph JSON | 約 43 MB |
| Shade Sidecar JSON | 約 7.9 MB |
| 都心5区内 Drinking Station 公開数 | 158 |

各区の Node / Edge が 0 より多いこと、および各区の代表 Node が同じ弱連結成分に属することを確認しています。Start / Destination は矩形 Bounding Box だけでなく、`service_area_tokyo_core5.geojson` の実 Polygon 内に制限されます。

## 修正したデータ欠落

旧 Tokyo23 Road Pipeline は区ごとに境界を切って Graph を取得し、結合後に最大弱連結成分だけを残していました。区境界で道路接続が切れたため、この処理は約 73% の Road Node を除外し、地図上に大きな空白を生じさせました。

Core5 Pipeline は五区 Union に対して OSMnx `graph_from_polygon` を 1 回だけ実行し、後段で Component を黙って削除しません。区別 Coverage と Cross-Ward Reachability が失敗した場合は Production を公開しません。

## Green / Water

Green と Water は M4 の正式処理を変更せず再利用しました。

- `green_score`: 道路 15m Buffer 内にある、公式定義で実緑被覆と確認できる Polygon の面積比代理値
- `water_penalty`: Edge Geometry から最寄りの公式 Drinking Station Point までの距離に基づく段階値
- 181,858 Edge すべてで両フィールドが有限かつ `[0,1]`
- 801 の有効な公式 Drinking Station が最近距離計算に参加
- ブラウザ表示用 GeoJSON は Core5 境界枠内の 158 Point

`green_score` は樹冠日陰、実測温度、医療リスクを表しません。`water_penalty` は経路が給水地点を実際に通過することを意味しません。

## Building Shade

Project PLATEAU 東京23区 2020 の公式 CityGML から、Core5 Service Area Polygon の 500m 影響区に交差する 126 mesh だけを増分処理しました。

- 完全な LOD2 を優先し、不完全な場合は建物全体を LOD1 にフォールバック
- 正式な Building Height は Geometry の `max(Z)-min(Z)`
- `measuredHeight` は QA のみで、Shade 計算には不使用
- 固定日 `2026-09-23`、Asia/Tokyo の 09:00 / 12:00 / 15:00
- Shade Schema `1.0.0` の Sidecar として公開し、Graph Schema `1.1.0` を変更しない
- mesh ごとに検証後、Raw GML・一時 Geometry・一時 Shadow を削除

処理結果は、有効 Building 293,663 棟、無効 Building 0 棟、完全 LOD2 29,561 棟、整棟 LOD1 フォールバック 264,102 棟です。126 mesh の完了と、181,858 Edge ID の完全一致を検証しました。未処理 mesh を Shade Score 0 として偽装していません。

| 時刻 | 平均 Shade Score | 中央値 | 非ゼロ Edge |
|---|---:|---:|---:|
| 09:00 | 0.504189 | 0.5792 | 120,150（66.07%） |
| 12:00 | 0.337076 | 0.0346 | 93,515（51.42%） |
| 15:00 | 0.602618 | 0.8229 | 133,862（73.61%） |

各時刻の最小値は 0、最大値は 1 で、全 Score が有効範囲内です。

## ブラウザ構成

Production は GitHub Pages から次の静的ファイルだけを読み込みます。

- `graph_tokyo_core5.json`
- `environment_metadata_tokyo_core5.json`
- `drinking_stations_tokyo_core5.geojson`
- `service_area_tokyo_core5.geojson`
- `shade_tokyo_core5.json`

Fastest は Shade を読みません。Balanced / Coolest は M10.5 の固定式をそのまま使用し、09:00 / 12:00 / 15:00 の Shade Context 切替時だけ再計算します。オンライン Backend、Database、Remote Routing API はありません。

## 制限

- OSM の歩行可否・道路属性はコミュニティデータの完全性と更新時点に依存します。
- Building Shade は建物 Geometry による固定日時の幾何モデルであり、実測日陰、樹木の日陰、天候、気温低下を表しません。
- Heat Exposure Score / Heat Exposure Index は経路比較用のモデル指標であり、熱中症確率、医療リスク、医学的に検証された効果ではありません。
- 対象は東京23区全域ではなく、連続性と静的配信の安定性を優先した東京都心5区です。
