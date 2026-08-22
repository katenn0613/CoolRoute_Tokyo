# CoolRoute Tokyo 东京都心5区 Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以连续五区 Union 重建可验证、可由 GitHub Pages 和浏览器可靠承载的东京都心5区 Road、Green、Water、Shade Production，并修复右上角地图控件重合。

**Architecture:** Python 离线 Pipeline 以统一 Core5 配置生成五个静态资产；React Loader 继续使用现有 JSON/GeoJSON 契约，浏览器 Weighted Dijkstra 和 M10.5 Formula 不变。简单 Runner 只负责编排、断点状态和失败恢复。

**Tech Stack:** Python 3、OSMnx 2.1.1、NetworkX、GeoPandas、Shapely、React、Vite、JavaScript、MapLibre GL JS、Vitest、unittest。

**Spec:** `docs/superpowers/specs/2026-08-22-tokyo-core5-production-design.md`

## Global Constraints

- 正式范围只包含千代田区、中央区、港区、新宿区、文京区，UI 名称固定为 `東京都心5区`。
- Graph Schema 保持 `1.1.0`，Shade Schema 保持 `1.0.0`。
- 不修改 Dijkstra、Route Cost、M5 Base Exposure 或 M10.5 Shade-aware Formula。
- 所有 Production 数据来自 OSM 或已登记官方数据，不生成 synthetic Production Data。
- Graph JSON 达到 90MB 时停止 Production 切换并报告。
- Pipeline 必须支持断点恢复，并逐 mesh 删除成功处理后的 Raw GML。

---

### Task 1: 修复地图右上角控件重合

**Files:**
- Modify: `src/components/MapLayerControls.jsx`
- Modify: `src/styles.css`
- Test: `tests/javascript/MapView.test.jsx`

**Interfaces:**
- Produces: `.shade-scenario-control` 两行布局。
- Preserves: MapLibre `NavigationControl` at `top-right`。

- [ ] 写失败测试，断言 Scenario label 使用 `shade-scenario-control` 且说明文字仍可访问。
- [ ] 运行 `npx vitest run tests/javascript/MapView.test.jsx`，确认因 class 缺失失败。
- [ ] 为 Scenario label 添加 class，并把 `.map-layer-controls` 调整为 `top:84px`、限制宽度；说明文字占 grid 第二行。
- [ ] 运行 MapView 定向测试并执行 1280px/390px CSS 静态检查。
- [ ] 提交 `fix: prevent map controls from overlapping`。

### Task 2: Core5 配置、Boundary 与 Road Graph

**Files:**
- Create: `config/tokyo_core5_area.json`
- Create: `scripts/tokyo_core5/__init__.py`
- Create: `scripts/tokyo_core5/config.py`
- Create: `scripts/tokyo_core5/process_road.py`
- Create: `tests/python/test_tokyo_core5_config.py`
- Create: `tests/python/test_tokyo_core5_road.py`

**Interfaces:**
- Produces: `load_core5_config(path=...) -> Core5Config`。
- Produces: `union_ward_boundaries(boundaries) -> Polygon|MultiPolygon`。
- Produces: `validate_ward_coverage(graph, boundaries) -> dict`。
- Produces: `data/processed/tokyo_core5/graph_schema_1_0_baseline.json` 与 `service_area_tokyo_core5.geojson`。

- [ ] 写配置失败测试：必须恰有五个固定 Ward ID，重复/缺失 ID 拒绝。
- [ ] 写 Road 回归失败测试：分别裁切的两个断图不得通过，统一 Union Graph 中两个 Ward 代表 Node 必须可达。
- [ ] 运行两个新测试并确认 RED。
- [ ] 实现最小 Config 和 Boundary union；Boundary 任一区失败则停止。
- [ ] 实现单次 `graph_from_polygon(core_union, network_type="walk", simplify=True, retain_all=False)`；不得再次取最大组件。
- [ ] 实现每区 Node/Edge、Bounds 和代表 Node 可达验证，并原子发布 Baseline/Service Area。
- [ ] 运行 Core5 Config/Road 测试。
- [ ] 提交 `fix: build connected Tokyo Core 5 road graph`。

### Task 3: Green/Water Core5 输出

**Files:**
- Create: `scripts/tokyo_core5/process_environment.py`
- Modify: `scripts/build_environment_graph.py`（仅增加可注入 area/output 参数时修改）
- Create: `tests/python/test_tokyo_core5_environment.py`

**Interfaces:**
- Consumes: Core5 Schema 1.0 baseline、官方 Green/Drinking Raw、Core5 config。
- Produces: `graph_tokyo_core5.json`、`environment_metadata_tokyo_core5.json`、`drinking_stations_tokyo_core5.geojson`。

- [ ] 写失败测试，断言 Output 名称、Schema 1.1.0 和每条 Edge 两个 `[0,1]` 字段。
- [ ] 运行测试确认 RED。
- [ ] 用薄 wrapper 复用 M4 build，不复制 Green/Water Formula；使用 staging + os.replace 原子发布。
- [ ] 运行环境定向测试。
- [ ] 提交 `feat: generate Tokyo Core 5 environment data`。

### Task 4: Core5 Shade Mesh 筛选与 Sidecar

**Files:**
- Create: `scripts/tokyo_core5/process_shade.py`
- Modify: `scripts/tokyo23/process_shade.py`（仅提取可复用参数时修改）
- Create: `tests/python/test_tokyo_core5_shade.py`

**Interfaces:**
- Consumes: Core5 Graph、Tokyo23 PLATEAU manifest、500m influence bounds。
- Produces: `select_relevant_entries(entries, graph_bounds, 500) -> tuple[PlateauEntry,...]`。
- Produces: `shade_tokyo_core5.json` 与 `data/processed/tokyo_core5/shade_state/`。

- [ ] 写失败测试，验证只选择与 500m 影响区相交 mesh，且 completed 但 shard 缺失必须重跑。
- [ ] 运行测试确认 RED。
- [ ] 参数化复用 M10 interval pipeline；每 mesh 成功后删除 Raw，全部合并前保留 shards。
- [ ] 缺少任一目标 mesh 时抛错，不发布 Sidecar。
- [ ] 验证 Edge ID exact coverage、三场景和值域。
- [ ] 运行 Shade 定向测试。
- [ ] 提交 `feat: generate Tokyo Core 5 building shade data`。

### Task 5: 最小断点 Runner

**Files:**
- Create: `scripts/tokyo_core5/run_pipeline.py`
- Create: `scripts/tokyo_core5/progress.py`
- Create: `tests/python/test_tokyo_core5_pipeline.py`

**Interfaces:**
- Produces CLI: `--status`、`--from-stage {road,environment,shade,validate}`、`--retry-failed`。
- Stores: `data/processed/tokyo_core5/progress.json`。

- [ ] 写失败测试：completed+output 存在才跳过；output 缺失重跑；失败阶段阻止后续阶段。
- [ ] 运行测试确认 RED。
- [ ] 实现四阶段顺序 Runner 和原子 progress，不引入插件或日志框架。
- [ ] 运行 Pipeline 定向测试。
- [ ] 提交 `feat: add resumable Tokyo Core 5 pipeline`。

### Task 6: Browser Loader、Service Area 与日语范围文案

**Files:**
- Modify: `src/config/demoArea.js`
- Modify: `src/config/dataSources.js`
- Modify: `src/routing/graphLoader.js`
- Modify: `src/shade/shadeLoader.js`
- Modify: `src/components/MapView.jsx`
- Modify: `src/App.jsx`
- Create: `src/routing/serviceArea.js`
- Modify: `tests/javascript/config.test.js`
- Modify: `tests/javascript/graphLoader.test.js`
- Modify: `tests/javascript/shadeLoader.test.js`
- Modify: `tests/javascript/App.test.jsx`
- Create: `tests/javascript/serviceArea.test.js`

**Interfaces:**
- Loads: Core5 Graph/Shade/Drinking/Service Area using `assetPath`。
- Produces: `isPointInServiceArea([lon,lat], geojson) -> boolean`。

- [ ] 写失败测试：默认路径必须为 Core5；UI 必须显示 `東京都心5区`；Polygon 外点拒绝。
- [ ] 运行定向测试确认 RED。
- [ ] 切换四个 Loader、范围文案与边界图层；在 nearest-node 前执行 Service Area 判断。
- [ ] 删除 Tokyo23 partial warning，不把问题数据标成 Core5。
- [ ] 运行 Browser 定向测试。
- [ ] 提交 `feat: enable Tokyo Core 5 production dataset`。

### Task 7: Production 数据运行、验证和文档

**Files:**
- Create: `scripts/tokyo_core5/validate.py`
- Create: `docs/TOKYO_CORE5_SCALE_REPORT_JA.md`
- Modify: `README.md`
- Modify: `docs/DATA_SOURCES.md`
- Modify: `docs/PROJECT_OVERVIEW_JA.md`
- Test: `tests/python/test_tokyo_core5_validation.py`

**Interfaces:**
- Consumes: 五个 Core5 Production assets。
- Produces: `data/processed/tokyo_core5/validation_report.json`。

- [ ] 写失败测试：缺 Ward、Graph ≥90MB、Shade Edge 不匹配、非法环境值必须阻止发布。
- [ ] 运行验证测试确认 RED，再实现 Validator。
- [ ] 执行 `run_pipeline.py`；长任务通过 progress 恢复，不人工编辑数据。
- [ ] 记录每区 counts、文件大小、LOD/mesh、三场景分布和处理时间。
- [ ] 更新三份项目文档和日语报告，统一 `東京都心5区` 与非医疗声明。
- [ ] 运行 Core5 Python/JavaScript 定向测试、`npm run build` 和 Pages subpath validation。
- [ ] 手动检查 Desktop/Mobile 控件、10 组跨区路线、09/12/15 和真实 Pages URL。
- [ ] 提交 `docs: document Tokyo Core 5 production coverage` 并等待合并确认。
