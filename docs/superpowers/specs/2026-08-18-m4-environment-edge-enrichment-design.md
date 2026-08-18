# CoolRoute Tokyo M4 环境 Edge Enrichment 设计规格

## 1. 阶段目标

M4 获取并验证真实东京官方环境开放数据，将可证明的环境特征离线映射到 M2 Road Graph Edge。正式运行仍是 GitHub Pages 静态站点，M4 不实现 Balanced Route、Coolest Route 或 Heat Exposure Score。

正式输出：

- `public/data/graph.json`：Browser Graph Schema 1.1.0，每条 Edge 在 M2/M3 字段之外增加 `green_score` 和 `water_penalty`；
- `public/data/drinking_stations.geojson`：只含浏览器需要的官方站点字段；
- `public/data/environment_metadata.json`：数据来源、语义白名单、参数、公式、质量统计和处理时间；
- `data/processed/green/`、`data/processed/drinking_station/`、`data/processed/environment/`：可复查的离线中间结果与检查报告。

## 2. 不变约束

- 不引入后端、数据库、PostGIS、Docker、线上 Python 或远程 Routing API。
- Python 仅用于离线下载、检查和 GIS 预处理。
- `data/raw/` 原始文件不得就地修改。
- 禁止伪造东京官方数据；Synthetic fixture 只进入 `tests/`。
- M4 不修改 Node ID、Edge ID、source、target、length、geometry 或 MultiEdge 结构。
- M3 Fastest cost 始终为 `edge.length`。
- M4 不计算 Heat Exposure Score，不进入 M5。

## 3. 数据源

### 3.1 Green

- Dataset：`緑のオープンデータ（GISデータ）`
- Provider：東京都都市整備局 都市づくり政策部緑地景観課
- Dataset URL：`https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d2000000024`
- 官方说明：`https://www.toshiseibi.metro.tokyo.lg.jp/information/press/r7/01/20260202`
- 数据定义：`https://data.storage.data.metro.tokyo.lg.jp/toshiseibi/green_teigisho.pdf`
- 文件列表：`https://data.storage.data.metro.tokyo.lg.jp/toshiseibi/green_filelist.pdf`
- Format：官方 ZIP 中的 Shapefile；实际文件、Encoding、CRS、字段和 geometry 必须从 Raw 检查得出。
- License：只采用资源页明确标记为 CC BY 的资源；不得用数据集级“その他”推断未标注资源的许可。

区级 H21 绿被数据不覆盖 Demo Area；土地利用 GIS 表示土地用途而非实际绿色覆盖；两者不作为 M4 主数据。

### 3.2 Drinking Station

- Dataset：`Tokyowater Drinking Station 一覧`
- Provider：東京都水道局
- Dataset URL：`https://catalog.data.metro.tokyo.lg.jp/dataset/t000019d0000000003`
- CSV URL：以官方目录当前登记资源为准，已核验资源为 `https://www.opendata.metro.tokyo.lg.jp/suidou/R7/tokyowaterdrinkingstation_250917.csv`
- License：CC BY
- Format：CSV；只读探查显示存在日文字段 `緯度`、`経度`，正式实现必须从持久化 Raw 文件再次确认 Encoding、字段、缺失值和坐标。
- 禁止调用商业 Geocoding API。

## 4. 三段门禁

```text
Official Source
  -> Raw Download / Cache + SHA-256 + provenance
  -> Schema Inspection Report
  -> Enrichment Candidate
  -> Quality Validation
  -> Atomic Production Publish
```

默认读取缓存；只有缓存缺失或显式 `--force-download` 才重新获取。强制下载不得静默破坏现有 Raw 快照，应先归档或使用带版本文件名。

Schema Inspection 对每个文件记录：

- 文件格式、字节数、SHA-256、下载时间、来源 URL；
- Encoding、CRS、Fields、Feature Count、Geometry Type、Bounding Box；
- 缺失值、无效 geometry、合法坐标数；
- Demo Area 相交数；
- Green Layer/Category 官方语义、白名单决定和理由。

Green Raw Schema 与官方定义不一致、关键字段无法解释或 Demo Area 不相交时，必须停止 Green Enrichment 并报告，不得凭名称猜测。

## 5. Green 语义白名单

不得先合并全部 Shapefile 再过滤。处理顺序必须是：逐个资源解压与检查 -> 逐个 Layer/Category 对照官方定义 -> 白名单过滤 -> 仅对白名单 Polygon 做 union。

默认规则：

- 官方定义明确表示实际绿色覆盖或从航空影像提取的绿色覆盖 Polygon：允许纳入；
- 语义不明确：排除；
- 公园/用地边界、规划区域、法规指定区域、水系：排除；
- 街路树 Point/Line：排除，不混入当前 Polygon Green Score；
- Geometry 不是 Polygon/MultiPolygon：排除。

初始候选仅包括 `樹林地`、`公共施設の緑`、`民間開発等による緑` 中官方定义明确表示实际绿色覆盖的 Polygon 子图层。最终白名单由真实 Raw 字段和官方定义共同决定。

每个检查到的 Layer/Category 都写入 metadata：官方名称、官方定义、几何类型、是否纳入、纳入或排除理由、Demo 相交数。

## 6. green_score

`green_score` 的唯一语义是：

> 道路 15 m Buffer 内由官方实际绿色覆盖 Polygon 估算的绿色覆盖比例代理值。

它不是 Shade Score、实际树冠遮阴比例、实际道路温度或医疗热风险。

空间计算统一转换至 `EPSG:6677`（JGD2011 / Japan Plane Rectangular CS IX，米制）。默认参数集中在环境配置中：

```text
greenBufferMeters = 15
projectedCRS = EPSG:6677
```

公式：

```text
green_union = unary_union(valid_whitelisted_green_polygons)
edge_buffer = buffer(edge_geometry, 15 m)
green_score = area(edge_buffer ∩ green_union) / area(edge_buffer)
```

先 union 再 intersection，避免重叠 Polygon 重复计数。结果必须为有限值且位于 `[0,1]`。

## 7. water_penalty 与站点数量

`water_penalty` 基于 EPSG:6677 中 Edge Geometry 到最近一个坐标有效的官方 Drinking Station Point 的最短距离。所有有效官方站点均参与最近距离计算，不只限 Demo Area 内站点。

默认分段：

```text
distance <= 100 m       -> 0.0
100 m < distance <= 300 -> 0.3
300 m < distance <= 500 -> 0.6
distance > 500 m        -> 1.0
```

阈值、闭区间方向和公式写入 metadata。

“路线附近有 N 个 Drinking Station”是独立指标，后续只能以 Route Geometry + 独立 configurable buffer 计算；不得由 `water_penalty` 反推，不得把“附近”表述成“路线实际经过”。M4 不实现路线级站点计数。

## 8. Browser Graph Schema 1.1.0

Edge 新契约：

```json
{
  "id": "u:v:key",
  "source": "u",
  "target": "v",
  "length": 42.5,
  "geometry": [[139.75, 35.68], [139.751, 35.681]],
  "green_score": 0.42,
  "water_penalty": 0.3
}
```

Graph Loader 支持 1.0.0 和 1.1.0；对 1.1.0 强制两个环境字段存在、有限且位于 `[0,1]`。正式发布后 metadata 的 `graphVersion` 为 `1.1.0`，其含义仍是 Browser Graph Schema Version。

发布前必须验证：

- Node 数、Edge 数、Edge ID 集合和有向 source/target 与 M3 基线完全一致；
- length 和 geometry 完全不变；
- MultiEdge 数量与结构不变；
- 每条 Edge 都有两个有效环境字段；
- JSON 写入采用临时文件后原子替换；验证失败保留现有 production Graph。

## 9. Drinking Station 浏览器文件

`public/data/drinking_stations.geojson` 只保留 Demo Area 或已记录邻近范围内的合法 Point，以及浏览器需要的字段：名称、所在地、设置位置、入场费说明、类型和来源标识。不得发布完整 Raw CSV。

如果官方数据有效但 Demo Area 没有站点，Registry 使用 `available_no_local_features`；不得生成假点。Water distance 仍可使用 Demo Area 外的有效官方站点。

## 10. Metadata 与 Registry

Registry 扩展状态：`ready`、`pending`、`not_started`、`available_no_local_features`、`unavailable`、`invalid`。

只有 Raw 获取、Schema Inspection、覆盖检查、Enrichment、质量验证和 production 发布全部成功后，Green/Drinking 才能改为 `ready`。状态必须与 `docs/DATA_SOURCES.md` 一致。

`environment_metadata.json` 至少记录：

- 数据集、Provider、Source URL、License、Raw SHA-256、下载时间；
- Raw Schema 和 CRS；
- Green 白名单决策表、EPSG:6677、15 m Buffer、公式；
- Water 距离公式和阈值；
- Demo 覆盖、输出统计、缺失和异常诊断；
- Environment Schema/processing version 和 generatedAt。

## 11. 数据质量门槛

分别输出 `min`、`mean`、`median`、`max`、`std`、零值占比、一值占比、NaN 和 Inf 数量。

必须拒绝：NaN、Inf、超出 `[0,1]`、Edge 字段缺失。分数全部相同不能直接成功；Green 几乎全零时必须诊断 CRS、覆盖、Buffer、白名单和 geometry validity，并在报告中解释结果是否可信。

## 12. M3 回归

Fastest Route 优先验证：

- 三条 M3 基线的 total distance 和 shortest-path cost 一致；
- Node/Edge/MultiEdge 数量不变；
- source、target、Edge ID、length、geometry 不变。

Edge Sequence 原则上应一致；完全等长的替代最短路径可以不同，但必须证明 cost 等价，不能由环境字段改变 Road Graph。

执行 Python 单元测试与 production validation、`npm test -- --run`、`npm run build`。完成后停止，不进入 M5。
