# CoolRoute Tokyo 东京都心5区 Production 设计规格

## 1. 背景与目标

M11 Tokyo23 数据生产曾按 23 个 Ward Polygon 分别裁切 OSM walking graph，再在合并后无条件保留最大弱连通分量。23 个下载任务合计得到 413,977 个 Node、1,213,334 条 Edge，Production 最终只保留 111,574 个 Node、327,240 条 Edge，造成大片真实道路缺失。

本阶段停止把当前数据描述为东京23区完整服务，改为可由纯浏览器可靠承载的连续 **东京都心5区**：千代田区、中央区、港区、新宿区、文京区。目标是在不修改 Routing Algorithm、Exposure Formula、Graph Schema 和静态部署架构的前提下，重新生成拓扑连续、覆盖可验证的 Road、Green、Water、Building Shade Production Data。

## 2. 范围与非目标

正式范围 ID 为 `tokyo_core_5_wards`，用户界面名称为 `東京都心5区`。五区行政区 Polygon 必须先 union，再作为单一 OSM 查询与服务区域来源。

本阶段不实现 Weather、Backend、Database、远程 Routing API、Binary Graph、Routing Worker、Vector Tile Routing 或新的 Route Formula。当前有问题的 Tokyo23 文件不得继续作为 Production 默认资产，也不得把残缺数据重新命名为 Core5。

## 3. 静态数据契约

Production 输出：

- `public/data/graph_tokyo_core5.json`
- `public/data/environment_metadata_tokyo_core5.json`
- `public/data/drinking_stations_tokyo_core5.geojson`
- `public/data/shade_tokyo_core5.json`
- `public/data/service_area_tokyo_core5.geojson`

Browser Graph Schema 保持 `1.1.0`，Edge 字段保持 `id/source/target/length/geometry/green_score/water_penalty`。Shade 保持 Schema `1.0.0` 独立 Sidecar，不写入 Road Graph。

原 Demo 数据继续保留。Tokyo23 问题数据不再被 Loader 引用；删除问题文件时依靠 Git History 恢复，不重写历史。

## 4. 地理配置与 Service Area

`config/tokyo_core5_area.json` 是 React 和 Python 的唯一正式配置源，记录五区 ID、名称、中心、zoom、最终 boundary-derived boundingBox 和 PLATEAU 配置。Bounding Box 不按经验手写，由真实五区 union geometry 计算后发布。

`service_area_tokyo_core5.geojson` 保存适合浏览器点选判断与边界显示的轻量 Polygon/MultiPolygon。简化不得改变五区包含关系；Start/Destination 先通过 Service Area 判断，再执行 maximum 200m nearest-node snapping。

## 5. Connected Road Graph

五区行政 Boundary 必须全部成功取得并验证后才可 union。Road Graph 使用一次 `OSMnx graph_from_polygon(core_union, network_type="walk", simplify=True, retain_all=False)` 获取，不能再次在下游执行 `largest weakly connected component` 裁剪。

`retain_all=False` 只应用于完整连续 Union 查询；它与旧的“分别裁切 Ward 后再取最大组件”不同。发布门禁要求每区都有 Node/Edge、五个代表 Node 互相可达、实际 Graph Bounds 与 Service Area 高度重合。任何一项失败即停止，不通过删除组件强行发布。

## 6. Green 与 Water

复用 M4 正式公式和数据语义。`green_score` 仍是道路 15m Buffer 内官方实际绿色覆盖 Polygon 的比例代理值；只使用既有语义白名单。`water_penalty` 继续由 Edge Geometry 至最近有效官方 Drinking Station Point 的距离计算。全部有效官方 Point 可参与距离计算，浏览器 GeoJSON 只发布 Core5 Service Area 显示范围内的点。

## 7. Building Shade

继续使用 Project PLATEAU 东京23区 2020 官方 CityGML。根据 Core5 Graph 及 500m 最大影响 Buffer，从官方 Manifest 自动选取相关 mesh，不手写清单。

高度来自完整 LOD2 Geometry Z Range；LOD2 不完整时整栋回退 LOD1，禁止混合 LOD。`measuredHeight` 只作 QA。Parser 必须支持 CityModel-level `gml:Envelope srsName` 向 Building 继承 EPSG:6697。

固定 `2026-09-23`、`Asia/Tokyo`、09:00/12:00/15:00。每个 mesh 保存 interval shard 后更新进度，随即删除 Raw GML 并释放内存；所有目标 mesh 合并和验证通过前保留 shards。缺少任何所需 mesh 时停止发布，不填 0、不发布 partial Sidecar。

## 8. Routing 与 UI

M5 Base Exposure 保持 `0.7 × (1-green_score) + 0.3 × water_penalty`。M10.5 Shade-aware Exposure 保持 `0.75 × baseHeatExposure + 0.25 × (1-shade_score)`。Fastest 只读取 length；Balanced/Coolest 继续复用同一个 Weighted Dijkstra。

正式 UI 只把范围改为 `東京都心5区` 并列出五区，不重构 Route Card、Compare Mode、Bottom Sheet 或 Route Detail。

当前 MapLibre NavigationControl 位于 top-right，自定义 `.map-layer-controls` 从 `top:62px` 开始，二者发生重叠。修复规则：NavigationControl 保持 top-right；Layer Panel 从 `top:84px` 开始、宽度限制为 `min(280px, calc(100% - 24px))`；Shade Scenario 使用两行 grid，说明文字独占第二行。Desktop/Mobile 均不得与缩放控件重叠或横向溢出。

## 9. 最小自动化 Pipeline

新增 `scripts/tokyo_core5/`，只包含 Road、Environment、Shade、Validation 和一个简单的阶段 Runner。Runner 支持 `--status`、`--from-stage`、`--retry-failed`，状态写入 `data/processed/tokyo_core5/`。它不建设插件、通用 ETL、复杂日志或配置框架。

阶段为 `road -> environment -> shade -> validate`。每阶段只有在原子输出和验证成功后才标记 completed。中断后跳过已完成且产物存在的阶段；产物缺失时不得只凭 progress 跳过。

## 10. 数据质量与性能门禁

Road 必须按五区分别报告 Node/Edge，并验证跨区可达；Graph Edge 必须有合法端点、正 length、有效方向 geometry。Green/Water/Shade 必须为有限 `[0,1]` 值；Shade Edge ID 必须与 Graph 完全一致。

Graph JSON 目标小于 90MB；达到或超过 90MB 时停止 Production 切换并报告，不临时改变 Schema 或精度。记录 Graph 下载、JSON parse、索引和三路线计算时间。目标为首次加载尽量小于 10 秒、三路线计算小于 3 秒。

## 11. 文档与声明

同步 README、PROJECT_OVERVIEW_JA、DATA_SOURCES 和新的 Core5 数据报告。文案必须明确范围是五区，不得声称东京23区。Heat Exposure Score 是模型比较指标，不是中暑概率、医疗风险或医学验证收益；Building Shade 是固定时间几何模型，不是实测温度或实时阴影。

## 12. 验收

五区 Road 覆盖、跨区路线、Green/Water、全部目标 Shade mesh、09/12/15、Fastest/Balanced/Coolest、GitHub Pages Asset Path 和真实 Pages URL 必须全部通过后才能把 Core5 分支合并到 main。
