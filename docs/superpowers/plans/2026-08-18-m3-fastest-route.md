# CoolRoute Tokyo M3 浏览器端 Fastest Route 实施计划

> **供执行代理使用：** 必须使用子技能 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务执行本计划。步骤使用复选框（`- [ ]`）跟踪。

**目标：** 使用 M2 真实 Road Graph，在纯浏览器端完成点击选点、吸附、Dijkstra、真实道路 geometry 显示和 Fastest Route 指标闭环。

**架构：** 纯函数模块负责 Graph、吸附、Dijkstra、geometry 和指标；单一 hook 持有 Graph ref 和交互状态机；MapView 只管理 MapLibre 对象，RouteControls 只展示状态和操作。所有路径由 Vite base-aware `assetPath` 产生，无远程 Routing API。

**技术栈：** React 19.2.8、Vite 8.2.1、JavaScript、MapLibre GL JS 6.4.0、Vitest 4.1.10。

**规格：** `docs/superpowers/specs/2026-08-18-m3-fastest-route-design.md`

## 全局约束

- 只实现 Fastest Route，Edge cost 仅为 `edge.length`。
- Balanced/Coolest 显示但禁用，不实现 Heat Exposure 或环境权重。
- Graph 只从 `assetPath('data/graph.json')` 加载，不硬编码 localhost。
- 不调用远程 Routing API，不引入后端或数据库。
- 保留有向 MultiEdge 和具体 Edge predecessor。
- 地图必须使用真实 Edge geometry。
- Synthetic Graph 只能位于测试目录。
- 当前目录不是 Git 仓库，不执行 branch、worktree 或 commit。

---

### 任务 1：Graph Loader 与 Routing 配置

**文件：**

- 创建：`src/config/routingConfig.js`
- 创建：`src/routing/graphLoader.js`
- 创建：`tests/javascript/graphLoader.test.js`

**接口：**

- `validateGraphPayload(payload) -> payload`
- `prepareGraph(payload) -> {metadata, nodes: Map, edges: Map, adjacency: Map}`
- `loadRoadGraph({fetchImpl = fetch, url = assetPath('data/graph.json')}) -> Promise<{graph, loadTimeMs}>`

- [x] **步骤 1：写失败测试，验证 base-aware URL、Schema 1.0.0、数量、引用和 MultiEdge adjacency。**

```js
const result = await loadRoadGraph({ fetchImpl })
expect(fetchImpl).toHaveBeenCalledWith(expect.stringMatching(/data\/graph\.json$/))
expect(result.graph.adjacency.get('a')).toHaveLength(2)
expect(() => prepareGraph({...payload, edges: [{...edge, target: 'missing'}]})).toThrow()
```

- [x] **步骤 2：运行 `npm test -- --run tests/javascript/graphLoader.test.js`，确认模块缺失导致 RED。**
- [x] **步骤 3：实现配置、验证、索引和 `performance.now()` 加载计时。**
- [x] **步骤 4：重跑定向测试，确认 GREEN。**

### 任务 2：Nearest Node、Dijkstra、Geometry 与指标

**文件：**

- 创建：`src/routing/nearestNode.js`
- 创建：`src/routing/dijkstra.js`
- 创建：`src/routing/routeGeometry.js`
- 创建：`src/routing/routeMetrics.js`
- 创建：`tests/javascript/fixtures/syntheticRoadGraph.js`
- 创建：`tests/javascript/nearestNode.test.js`
- 创建：`tests/javascript/dijkstra.test.js`
- 创建：`tests/javascript/routeGeometry.test.js`

**接口：**

- `isPointInDemoArea([lon, lat], boundingBox) -> boolean`
- `findNearestNode(graph, [lon, lat], {boundingBox, maximumDistanceMeters}) -> {node, distanceMeters}`
- `findShortestPath(graph, startId, destinationId) -> RouteResult`
- `buildRouteGeoJSON(edgeSequence) -> GeoJSON Feature | null`
- `calculateRouteMetrics(edgeSequence, walkingSpeedMetersPerSecond) -> metrics`

- [x] **步骤 1：写 nearest-node RED 测试，覆盖最近点、严格越界和 200 m 上限。**
- [x] **步骤 2：写 Dijkstra RED 测试，使用手算 fixture 覆盖最短路、不可达、同点、平行边和距离。**

```js
expect(findShortestPath(graph, 'a', 'd')).toMatchObject({
  found: true,
  nodeSequence: ['a', 'b', 'd'],
  edgeSequence: [expect.objectContaining({id: 'a:b:fast'}), expect.any(Object)],
  totalDistance: 7,
})
```

- [x] **步骤 3：写 geometry/metrics RED 测试，断言使用 Edge 中间形状点且接缝只出现一次。**
- [x] **步骤 4：运行三个测试文件，确认对应模块缺失导致 RED。**
- [x] **步骤 5：实现线性吸附、二叉最小堆 Dijkstra、Edge geometry 拼接和统一速度指标。**
- [x] **步骤 6：重跑定向测试和 Graph Loader 测试，确认 GREEN。**

### 任务 3：事务式选择状态机与 Routing Hook

**文件：**

- 创建：`src/routing/selectionMachine.js`
- 创建：`src/routing/useFastestRoute.js`
- 创建：`tests/javascript/selectionMachine.test.js`
- 创建：`tests/javascript/useFastestRoute.test.jsx`

**接口：**

- `createInitialSelectionState() -> state`
- `selectionReducer(state, event) -> state`
- Hook 输出 `{phase, graphStatus, start, destination, route, metrics, error, prompt, selectStart, selectDestination, reset, recalculate, handleMapClick}`。

- [x] **步骤 1：写 reducer RED 测试，覆盖五个 phase、Reset、route-ready 忽略点击和重选失败不提交。**
- [x] **步骤 2：写 hook RED 测试，用真实纯函数和注入 Loader 验证第二次点击自动计算、重选成功原子提交、失败保留旧路线。**
- [x] **步骤 3：运行定向测试，确认模块缺失导致 RED。**
- [x] **步骤 4：实现 reducer；候选成功事件一次携带 point、snappedNode 和 route bundle。**
- [x] **步骤 5：实现 hook，用 `useRef` 持有 prepared Graph，组件 state 不保存 3.4 MB payload。**
- [x] **步骤 6：重跑状态机与 hook 测试，确认 GREEN。**

### 任务 4：React 与 MapLibre 集成

**文件：**

- 修改：`src/App.jsx`
- 修改：`src/components/MapView.jsx`
- 修改：`src/components/RouteControls.jsx`
- 修改：`src/styles.css`
- 修改：`tests/javascript/App.test.jsx`
- 修改：`tests/javascript/MapView.test.jsx`

**接口：**

- `MapView({onMapClick, start, destination, routeGeoJSON, interactionEnabled})`
- `RouteControls({routingState})`

- [x] **步骤 1：先修改 App 测试，要求 Fastest 可用、Balanced/Coolest 禁用、Find Route 保留和三种重选/Reset 控件。**
- [x] **步骤 2：先修改 MapView 测试，要求 map click 转发、两个 Marker、route source/layer 更新与清理。**
- [x] **步骤 3：运行测试，确认现有 M1 UI 不满足 M3 行为。**
- [x] **步骤 4：接入 hook；RouteControls 根据 phase 显示提示、指标和错误，Find Route 仅在两点有效时启用。**
- [x] **步骤 5：MapView 创建 Marker 并用 `setData(routeGeoJSON)` 更新真实路线。**
- [x] **步骤 6：重跑全部前端单元测试，确认 GREEN。**

### 任务 5：真实东京路线、性能和文档验收

**文件：**

- 创建：`tests/javascript/realTokyoRoutes.test.js`
- 创建：`scripts/benchmark_routing.mjs`
- 修改：`README.md`
- 修改：`PROJECT_SPEC.md`
- 修改：本计划

- [x] **步骤 1：用 production `graph.json` 定义三组 Demo Area 坐标并写真实路线测试。**

```js
const cases = [
  ['东京站北侧到丸之内', [139.7671, 35.6836], [139.7618, 35.6812]],
  ['大手町到东京站', [139.7638, 35.6870], [139.7671, 35.6812]],
  ['皇居东侧到有乐町', [139.7555, 35.6845], [139.7620, 35.6752]],
]
```

- [x] **步骤 2：验证每条路线存在、距离在 50–5000 m、Edge 连续、GeoJSON 完整复用 Edge geometry。**
- [x] **步骤 3：运行 benchmark，记录 Graph parse/prepare 时间和每条 Dijkstra 时间。**
- [x] **步骤 4：运行 `npm test -- --run` 和 `npm run build`。**
- [ ] **步骤 5：在真实浏览器中检查选点、重选、Reset、Marker、路线和控制台。当前执行环境没有可连接的浏览器，保留为人工视觉验收项；正式预览页及 `graph.json` 均已验证返回 HTTP 200。**
- [x] **步骤 6：更新 README、PROJECT_SPEC 和 M3 状态，扫描并确认无远程 Routing API、环境权重或 M4 实现。**
