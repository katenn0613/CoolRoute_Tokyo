# CoolRoute Tokyo M5 Heat Exposure Model 与三模式路由实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在纯浏览器端实现统一 Heat Exposure Model、单一 Weighted Dijkstra、Fastest/Balanced/Coolest 三路线、平均与累计暴露指标、基础 UI 和可复现真实东京案例。

**Architecture:** M4 Edge 字段进入纯函数 Exposure/Cost 层；一个 `weightedDijkstra` 接受 Weight Function；路线服务一次计算三种模式并生成 metrics/comparison；现有状态机事务式提交完整 route bundle，UI 只切换选中路线。

**Tech Stack:** React 19、Vite 8、JavaScript、MapLibre GL JS、Vitest；正式运行无后端。

**Spec:** `docs/superpowers/specs/2026-08-18-m5-heat-exposure-routing-design.md`

**执行状态（2026-08-18）：** 已完成。当前目录不是 Git 仓库，因此以 RED/GREEN 定向测试、真实案例重算、完整 Vitest、Vite production build 和独立代码审阅作为检查点。

## Global Constraints

- 正式应用必须保持 GitHub Pages 静态部署，寻路只在浏览器 JavaScript 中运行。
- 仅使用 Heat Exposure Score、Heat Exposure Index、Modelled Heat Exposure、热暴露评分、模型热暴露指标、Modelled Exposure Load。
- 禁止医疗概率、医学风险下降、剂量或安全保证表述。
- 不修改 `public/data/graph.json` 的真实 Edge Score，不进入 M6。
- `maximumExtraDistanceRatio = null`，M5 不启用 Detour Guard 阈值。

---

### Task 1: Exposure、Cost 与统一配置

**Files:**
- Create: `src/routing/exposureModel.js`
- Modify: `src/config/routingConfig.js`
- Create: `tests/javascript/exposureModel.test.js`

**Interfaces:**
- `calculateEdgeHeatExposure(edge, config?) -> number`
- `createEdgeWeightFunction(mode, config?) -> (edge) => number`
- `ROUTING_MODES = { FASTEST, BALANCED, COOLEST }`

- [x] 写失败测试，覆盖 0.7/0.3 公式、范围边界、lambda=0、成本非负以及缺失/NaN/Inf/越界字段。
- [x] 运行 `npm test -- --run tests/javascript/exposureModel.test.js`，确认 RED。
- [x] 在统一配置中加入 weights、lambdas 和 `maximumExtraDistanceRatio: null`，实现最小纯函数。
- [x] 重跑定向测试，确认 GREEN。

### Task 2: 泛化单一 Weighted Dijkstra

**Files:**
- Modify: `src/routing/dijkstra.js`
- Modify: `tests/javascript/dijkstra.test.js`

**Interfaces:**
- `weightedDijkstra(graph, startId, destinationId, weightFunction) -> RouteResult`
- `findShortestPath(...)` 是 distance-only 包装。
- `RouteResult` 包含 `found/totalCost/totalDistance/nodeSequence/edgeSequence`。

- [x] 写失败测试，证明 Fastest 等价旧实现、lambda 0 等价 Fastest、高 lambda 避开高 Exposure Edge、MultiEdge 保留、无效 Weight 明确失败。
- [x] 运行 Dijkstra 定向测试确认 RED。
- [x] 将现有算法改为注入 Weight Function，保留兼容包装，不复制算法。
- [x] 重跑 Dijkstra 与 M3 回归，确认 GREEN。

### Task 3: Route Metrics、Comparison 与 Detour Guard

**Files:**
- Modify: `src/routing/routeMetrics.js`
- Create: `src/routing/routeComparison.js`
- Create: `tests/javascript/routeExposureMetrics.test.js`
- Create: `tests/javascript/routeComparison.test.js`

**Interfaces:**
- `calculateRouteMetrics(edges, config?)`
- `compareRouteToFastest(candidate, fastest) -> comparison`
- `passesDetourGuard(candidateDistance, fastestDistance, maximumExtraDistanceRatio) -> boolean`

- [x] 写失败测试：长度加权 Average、Exposure Load、Green/Water、平均下降但 Load 上升、累计 reduction percent、基准 0 返回 null、Detour ratio 语义。
- [x] 运行定向测试确认 RED。
- [x] 实现 metrics/comparison/guard，所有结果检查 finite，零长度路线使用明确中性结果。
- [x] 重跑定向测试确认 GREEN。

### Task 4: 三模式 Route Bundle 与事务式状态

**Files:**
- Create: `src/routing/calculateRouteBundle.js`
- Modify: `src/routing/useFastestRoute.js`（保留导出名兼容，内部升级为三模式）
- Modify: `src/routing/selectionMachine.js`
- Modify: `tests/javascript/useFastestRoute.test.jsx`
- Modify: `tests/javascript/selectionMachine.test.js`

**Interfaces:**
- `calculateRouteBundle(graph, startId, destinationId, config?) -> { routes, comparisons }`
- Hook 返回 `routes/selectedMode/selectMode/metrics/routeGeoJSON`。

- [x] 写失败测试：一次产生三路线、切换模式不重算、重选失败保留旧 bundle、Reset 清除、Detour Guard 默认关闭。
- [x] 运行 hook/state 定向测试确认 RED。
- [x] 实现 route bundle 和状态事件 `ROUTE_MODE_SELECTED`，保留 M3 五态与事务提交。
- [x] 重跑 hook/state 测试确认 GREEN。

### Task 5: M5 基础 UI

**Files:**
- Modify: `src/components/RouteControls.jsx`
- Modify: `src/App.jsx`
- Modify: `tests/javascript/App.test.jsx`

**Interfaces:**
- Radio 调用 `selectMode(mode)`；地图继续接收当前 `routeGeoJSON`。
- 每种路线显示 Distance、Walking Time、Heat Exposure Score；比较显示 Modelled Exposure Load change。

- [x] 写失败 UI 测试：三个 Radio 可用、选择切换、三路线指标标签、准确的 Average/Load 文案、无医疗性文案。
- [x] 运行 App 定向测试确认 RED。
- [x] 实现紧凑三路线显示，不新增大规模页面结构或地图多路线图层。
- [x] 重跑 UI 测试确认 GREEN。

### Task 6: 固定种子真实东京案例搜索

**Files:**
- Create: `scripts/find_m5_route_cases.mjs`
- Create: `public/data/m5_route_cases.json`
- Create: `tests/javascript/m5RealTokyoCases.test.js`

**Interfaces:**
- 固定 seed 候选采样；输出 Start/Destination Node ID、三模式 Edge IDs、distance、time、average exposure、exposure load、calculation time。

- [x] 实现有界候选采样，不遍历全部 Node Pair，不修改 graph。
- [x] 运行脚本，保存至少 5 个可复现案例。
- [x] 验证至少 1 个 Fastest==Coolest、至少 2–3 个自然 Trade-off，且结果可按 Node ID 重算。
- [x] 增加正式案例回归测试并确认 GREEN。

### Task 7: 文档、完整验证与停止门禁

**Files:**
- Modify: `PROJECT_SPEC.md`
- Modify: `README.md`
- Create: `docs/METHODOLOGY.md`
- Modify: 本计划

**Interfaces:** 文档必须区分 Average Heat Exposure、Modelled Exposure Load 和 Routing Cost；准确说明 Coolest 与 Water Access Indicator。

- [x] 更新中文方法文档和阶段状态，扫描禁止医疗表述与 M6 越界实现。
- [x] 运行 `npm test -- --run`。
- [x] 运行 `npm run build` 并确认 M5 静态案例资源进入 `dist/data/`。
- [x] 运行独立代码审阅，修复全部 Critical/Important。
- [x] 记录公式、参数、真实案例、运行时间、限制和修改文件；完成后停止。
