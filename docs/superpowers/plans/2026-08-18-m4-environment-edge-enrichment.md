# CoolRoute Tokyo M4 环境 Edge Enrichment 实施计划

> **供执行代理使用：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务执行。步骤用复选框跟踪。

**目标：** 获取并检查真实官方 Green/Drinking Station Raw 数据，以 EPSG:6677 将实际绿色覆盖比例代理值和最近饮水点距离惩罚映射到每条 Road Edge，并原子发布 Browser Graph Schema 1.1.0。

**架构：** 复用 M1 Source Layer，Raw 下载、Schema Inspection、Enrichment、Validation 和 Production Publish 分段执行。Green 先按官方语义白名单筛选 Polygon，再 union；Water 使用所有有效官方 Point。M3 Graph 的道路字段不可变化。

**技术栈：** Python 3.12、GeoPandas、Shapely、Pandas、NetworkX、React/Vite/JavaScript、Vitest。当前环境没有可选 PyArrow，因此实际局部缓存使用 GeoPackage。

**规格：** `docs/superpowers/specs/2026-08-18-m4-environment-edge-enrichment-design.md`

**执行状态（2026-08-18）：** 已完成。实际实现按真实 Raw Schema 使用 GPKG 作为局部白名单缓存（当前环境未安装可选 `pyarrow`，不影响生产格式），并增加 100m 无损空间分片以控制复杂 Polygon 的离线求交成本。正式输入基线保存在 `data/processed/environment/graph_schema_1_0_baseline.json`；生产门禁由 `tests/python/test_environment_production.py`、M4 Fastest 回归测试与完整构建共同执行。

## 全局约束

- 正式运行仍为 GitHub Pages 静态站点，无后端、数据库或远程 Routing API。
- `green_score` 仅表示“道路 15 m Buffer 内由官方实际绿色覆盖 Polygon 估算的绿色覆盖比例代理值”。
- 不把公园/规划/法规边界、水系或 Point/Line 街路树混入 Green Polygon。
- `water_penalty` 与路线附近站点数量是独立指标；M4 不实现路线级站点数量。
- M4 不实现 Heat Exposure Score、Balanced、Coolest 或 M5 功能。
- 当前目录不是 Git 仓库，不执行 worktree 或 commit；每个任务以测试和产物验证为检查点。

---

### 任务 1：官方 Source 下载与缓存契约

**文件：**

- 修改：`scripts/data_sources/source_utils.py`
- 修改：`scripts/data_sources/green_source.py`
- 修改：`scripts/data_sources/drinking_station_source.py`
- 创建：`scripts/fetch_environment_data.py`
- 修改：`tests/python/test_data_sources.py`

**接口：**

- `download_file(url, destination, force_download=False) -> DownloadRecord`
- `GreenSource.fetch(force_download=False) -> tuple[DownloadRecord, ...]`
- `DrinkingStationSource.fetch(force_download=False) -> tuple[DownloadRecord, ...]`

- [x] 写失败测试：缓存命中不发网络请求、force 覆盖前归档、失败不留下 partial、SHA-256 和 URL 被记录。
- [x] 运行 `python -m unittest tests.python.test_data_sources -v`，确认 RED。
- [x] 实现通用原子下载与两个官方 Source；Green 只下载官方文档和待检查候选资源，不进行语义合并。
- [x] 重跑测试，确认 GREEN。
- [x] 执行 `.venv/bin/python scripts/fetch_environment_data.py`；若无 `.venv`，先按 `requirements-dev.txt` 建立环境。

### 任务 2：Raw Schema Inspection 硬门禁

**文件：**

- 创建：`scripts/environment/__init__.py`
- 创建：`scripts/environment/config.py`
- 创建：`scripts/environment/inspect_sources.py`
- 创建：`scripts/inspect_environment_data.py`
- 创建：`tests/python/test_environment_inspection.py`

**接口：**

- `inspect_green_archives(raw_paths, demo_area) -> GreenInspectionReport`
- `inspect_drinking_csv(raw_path, demo_area) -> DrinkingInspectionReport`
- 输出：`data/processed/environment/schema_inspection.json`

- [x] 写失败测试：报告 Encoding/CRS/Fields/Geometry/Bounds/Demo intersection；非 Polygon、未知语义、缺 CRS、无坐标必须产生明确决定或错误。
- [x] 运行定向测试确认 RED。
- [x] 实现只读检查；决策表逐 Layer/Category 记录官方定义、include、reason，未知语义默认排除。
- [x] 重跑测试确认 GREEN。
- [x] 对真实 Raw 执行 `.venv/bin/python scripts/inspect_environment_data.py`，保存并人工审阅报告。
- [x] 若真实字段与官方定义不能证明实际绿色覆盖，停止 Green Enrichment 并报告；不得继续任务 3。

### 任务 3：Green/Water 纯计算函数

**文件：**

- 创建：`scripts/environment/enrich_edges.py`
- 创建：`tests/python/test_environment_enrichment.py`

**接口：**

- `build_green_union(green_frames, projected_crs) -> BaseGeometry`
- `calculate_green_score(edge, green_union, buffer_meters) -> float`
- `water_penalty_for_distance(distance_meters, thresholds) -> float`
- `nearest_station_distance(edge, stations) -> float`

- [x] 写 Green RED 测试：15 m Buffer 手算覆盖、重叠 Polygon 不重复、0/1 边界、无效 geometry。
- [x] 写 Water RED 测试：100/300/500 m 边界、Edge-to-Point 距离而非 Node 距离、空站点失败。
- [x] 运行定向测试确认 RED。
- [x] 以 EPSG:6677 和集中配置实现最小计算函数。
- [x] 重跑测试确认 GREEN。

### 任务 4：Graph 1.1.0 Enrichment、质量验证与原子写入

**文件：**

- 修改：`scripts/environment/enrich_edges.py`
- 创建：`scripts/build_environment_graph.py`
- 创建：`tests/python/test_environment_production.py`

**接口：**

- `enrich_graph_payload(baseline, green_union, stations, config) -> payload`
- `validate_enriched_graph(baseline, candidate) -> EnvironmentStatistics`
- `write_outputs_atomically(candidate, stations_geojson, metadata, paths) -> None`

- [x] 写失败测试：所有 Edge 新字段、道路字段深度不变、MultiEdge/ID 集合不变、Schema 1.1.0、NaN/Inf/越界/全部相同拒绝、写入失败不替换 production。
- [x] 运行定向测试确认 RED。
- [x] 实现 enrichment、统计、异常诊断和三文件原子发布。
- [x] 重跑测试确认 GREEN。
- [x] 真实运行前复制 M3 graph baseline 到 `data/processed/environment/graph_schema_1_0_baseline.json`，不得修改该基线。

### 任务 5：浏览器 Graph Loader 兼容 Schema 1.1.0

**文件：**

- 修改：`src/routing/graphLoader.js`
- 修改：`tests/javascript/graphLoader.test.js`

**接口：**

- 1.0.0 继续接受原道路字段；1.1.0 强制 `green_score`、`water_penalty` 为 `[0,1]` 有限数。

- [x] 写 JS RED 测试：1.1.0 合法 payload 可加载，字段缺失、NaN、Inf、越界值拒绝，1.0.0 fixture 继续通过。
- [x] 运行 `npm test -- --run tests/javascript/graphLoader.test.js` 确认 RED。
- [x] 实现双 Schema 验证，不修改 Dijkstra cost。
- [x] 重跑定向测试确认 GREEN。

### 任务 6：真实 Enrichment 与 Production 发布

**文件/产物：**

- 生成：`data/processed/green/`
- 生成：`data/processed/drinking_station/`
- 生成：`data/processed/environment/`
- 更新：`public/data/graph.json`
- 生成：`public/data/drinking_stations.geojson`
- 生成：`public/data/environment_metadata.json`

- [x] 运行 `.venv/bin/python scripts/build_environment_graph.py --baseline data/processed/environment/graph_schema_1_0_baseline.json`。
- [x] 检查 Green/Water 的 min、mean、median、max、std、0/1 占比、NaN/Inf；Green 近乎全零时检查 CRS、覆盖、Buffer、白名单和 geometry。
- [x] 验证 production `graph.json` 为 1.1.0，且 5,350 Node、16,046 Edge 与基线道路字段完全一致。
- [x] 验证 `drinking_stations.geojson` 仅含必要字段和合法 Point。
- [x] 验证 metadata 完整记录来源、许可、Raw 哈希、白名单、公式、参数和统计。

### 任务 7：Registry、文档和 M3 回归

**文件：**

- 修改：`src/config/dataSources.js`
- 修改：`src/components/DataStatus.jsx`（只在状态标签需要扩展时）
- 修改：`docs/DATA_SOURCES.md`
- 修改：`README.md`
- 修改：`PROJECT_SPEC.md`
- 修改：本计划

- [x] 只有真实发布成功后将 Green/Drinking 改为 `ready`；无本地站点使用 `available_no_local_features`。
- [x] 文档逐项记录 Green 白名单纳入/排除理由和非 Shade/温度/医疗语义。
- [x] 执行 `.venv/bin/python -m unittest discover -s tests/python -v`。
- [x] 执行 `tests/python/test_environment_production.py` 的 production validation（道路字段深比较、Edge 字段、metadata 与 GeoJSON）。
- [x] 执行 `npm test -- --run`，确认 M3 三条基线 total distance/cost 一致；等长 Edge Sequence 差异仅在证明 cost 等价时接受。
- [x] 执行 `npm run build` 并验证静态资源进入 `dist/data/`。
- [x] 扫描并确认无 M5、Heat Exposure、Balanced/Coolest 实现；完成后停止。
