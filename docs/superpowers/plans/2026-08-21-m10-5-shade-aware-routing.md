# CoolRoute Tokyo M10.5 Shade-aware Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以固定 `shadeContributionWeight = 0.25` 让 M10 `shade.json` 在 09:00、12:00、15:00 三个场景中参与 Balanced/Coolest 路径计算，同时保持 Fastest、Road Graph 和 M7 基线不变。

**Architecture:** `shade.json` 继续作为独立 Sidecar；现有 `useRouteBundle` 保持 Graph loading 职责，并在内部加载、验证和持有不可变 Shade Context。现有 Green/Water Heat Exposure 保留为 Base Exposure，新公式只在 Balanced/Coolest 的 Weight Function 和新增 Shade-aware Metrics 中组合 Shade；Fastest、M5 Metrics、M7 Comparison 均保持兼容。固定参数完成定向测试、Production Build 和 GitHub Pages 验收后直接上线，不建设参数评价流水线。

**Tech Stack:** React 19、Vite 8、JavaScript、MapLibre GL JS、Vitest、GitHub Pages 静态资源。

**Spec:** `docs/superpowers/specs/2026-08-21-m10-building-shade-design.md`（M10 Sidecar 数据契约）及本计划“全局约束”中记录的已批准 M10.5 决策。

## Global Constraints

- 正式公式固定为 `shadeAwareHeatExposure = 0.75 × baseHeatExposure + 0.25 × (1 - shade_score)`。
- `baseHeatExposure = 0.7 × (1 - green_score) + 0.3 × water_penalty`，必须继续复用 M5 的正式实现，不复制第二套 Green/Water 公式。
- `shadeContributionWeight = 0.25` 表示环境因素贡献比例，不表示阴影强度。
- 不进行多权重敏感性分析、参数搜索、参数优化或自动选参。
- 只支持 `09:00`、`12:00`、`15:00`；场景顺序必须与 Shade Schema 1.0.0 一致。
- `graph.json`、Road Graph Schema 1.1.0、Node、Edge、length、geometry、Green/Water 字段均不得修改。
- Fastest 始终只使用 `edge.length`，不得读取 Shade Context。
- Balanced/Coolest 继续复用同一个 `weightedDijkstra`，不得复制寻路算法。
- `shade.json` 保持独立 Sidecar；不得把 `shade_score` 写回 graph Edge。
- M7 的 `evaluation/evaluation_results.json`、`evaluation/evaluation_summary.json` 和 `docs/EVALUATION_SUMMARY_JA.md` 不得覆盖或修改。
- 不运行多权重参数评价、敏感性分析或自动选参，不生成新的参数评价数据集。
- 不执行 90 OD × 三场景批量验证；真实路线行为由用户上线后手动验收。
- M7 基线文件不得覆盖、读取后改写或重新生成。
- 所有新 Exposure 表述必须使用 Heat Exposure Score、Modelled Heat Exposure、热暴露评分；不得表述为医疗风险或中暑概率。
- Shade 数据缺失时不得静默把 Green/Water-only 结果标成 Shade-aware；UI 必须明确显示回退状态。
- 时间场景切换属于 Routing Cost 变化，已有起终点时需要重新计算；Route Card 切换仍不得重新运行 Dijkstra。

## File Structure

- `src/config/routingConfig.js`：固定 `shadeContributionWeight: 0.25`，继续集中管理全部路线参数。
- `src/routing/shadeContext.js`：把已验证 Sidecar 和场景转换为不可变 `{ scenario, shadeWeight, scoreByEdgeId, sourceMetadata }`。
- `src/routing/exposureModel.js`：唯一 Shade-aware Edge Exposure 与 Weight Function 入口。
- `src/routing/routeMetrics.js`：同时计算既有 Base 指标和新增 Shade-aware 指标。
- `src/routing/calculateRouteBundle.js`：把同一 Shade Context 注入 Balanced/Coolest 的 Cost 与 Metrics。
- `src/shade/shadeLayer.js`：继续只负责已加载 Sidecar 到地图 GeoJSON 的转换。
- `src/routing/useRouteBundle.js`：保持现有 Graph loading，并新增 Shade Sidecar、场景 Context 和事务性重算。

---

### Task 1: 固定参数并建立 Shade Context 契约

**Files:**
- Create: `src/routing/shadeContext.js`
- Modify: `src/config/routingConfig.js`
- Test: `tests/javascript/shadeContext.test.js`
- Test: `tests/javascript/routingConfig.test.js`

**Interfaces:**
- Consumes: `validateShadePayload(payload, graph)` 已验证的 Shade Schema 1.0.0 payload。
- Produces: `createShadeContext(payload, scenario, shadeWeight = 0.25) -> Readonly<{ scenario, shadeWeight, scoreByEdgeId, sourceMetadata }>`。
- Produces: `getEdgeShadeScore(context, edgeId) -> number`，结果严格处于 `[0,1]`。
- Produces: `routingConfig.shadeContributionWeight === 0.25`。

- [ ] **Step 1: 写固定参数和 Context 失败测试**

```js
it('固定 Shade 环境贡献比例为 0.25', () => {
  expect(routingConfig.shadeContributionWeight).toBe(0.25)
})

it('按正式场景建立 Edge Shade Score Map', () => {
  const context = createShadeContext({
    metadata: {
      schemaVersion: '1.0.0',
      roadGraphSchemaVersion: '1.1.0',
      scenarios: ['09:00', '12:00', '15:00'],
    },
    edgeShadeScores: { 'a:b:0': [0.2, 0.5, 0.9] },
  }, '12:00')
  expect(getEdgeShadeScore(context, 'a:b:0')).toBe(0.5)
  expect(() => getEdgeShadeScore(context, 'missing')).toThrow(/missing/)
})
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- tests/javascript/shadeContext.test.js tests/javascript/routingConfig.test.js --run`

Expected: FAIL，原因是 `shadeContext.js` 和配置字段尚不存在。

- [ ] **Step 3: 实现最小只读 Context**

```js
export function createShadeContext(payload, scenario) {
  const scenarioIndex = payload.metadata.scenarios.indexOf(scenario)
  if (scenarioIndex < 0) throw new RangeError(`不支持的 Shade 场景：${scenario}`)
  const scores = new Map(
    Object.entries(payload.edgeShadeScores).map(([edgeId, values]) => [edgeId, values[scenarioIndex]]),
  )
  const scoreByEdgeId = Object.freeze({
    get: (edgeId) => scores.get(edgeId),
    has: (edgeId) => scores.has(edgeId),
    size: scores.size,
  })
  return Object.freeze({
    scenario,
    shadeWeight: 0.25,
    scoreByEdgeId,
    sourceMetadata: Object.freeze({
      shadeSchemaVersion: payload.metadata.schemaVersion,
      roadGraphSchemaVersion: payload.metadata.roadGraphSchemaVersion,
      roadGraphGeneratedAt: payload.metadata.roadGraphGeneratedAt,
    }),
  })
}

export function getEdgeShadeScore(context, edgeId) {
  const score = context?.scoreByEdgeId?.get(edgeId)
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new RangeError(`Edge ${edgeId} 缺少有效 Shade Score。`)
  }
  return score
}
```

- [ ] **Step 4: 运行定向测试**

Run: `npm test -- tests/javascript/shadeContext.test.js tests/javascript/routingConfig.test.js --run`

Expected: PASS。

- [ ] **Step 5: 提交 Context 检查点**

```bash
git add src/config/routingConfig.js src/routing/shadeContext.js tests/javascript/shadeContext.test.js tests/javascript/routingConfig.test.js
git commit -m "feat: add shade routing context"
```

### Task 2: 实现唯一 Shade-aware Exposure Formula

**Files:**
- Modify: `src/routing/exposureModel.js`
- Test: `tests/javascript/exposureModel.test.js`

**Interfaces:**
- Consumes: `calculateEdgeHeatExposure(edge, config) -> baseHeatExposure`。
- Consumes: `getEdgeShadeScore(shadeContext, edge.id) -> shadeScore`。
- Produces: `calculateShadeAwareHeatExposure(edge, shadeContext, overrides = {}) -> number`。
- Modifies: `createEdgeWeightFunction(mode, overrides = {}, environmentContext = null) -> (edge) => nonNegativeCost`。

- [ ] **Step 1: 写公式、范围和 Fastest 隔离 RED 测试**

```js
it('按 0.25 贡献比例组合 Base Exposure 与 Shade', () => {
  const edge = { id: 'a:b:0', length: 100, green_score: 0.2, water_penalty: 0.5 }
  const shade = { scoreByEdgeId: new Map([['a:b:0', 0.8]]) }
  const base = 0.7 * 0.8 + 0.3 * 0.5
  expect(calculateShadeAwareHeatExposure(edge, shade)).toBeCloseTo(0.75 * base + 0.25 * 0.2)
})

it('Fastest 不访问 Shade Context', () => {
  const throwingContext = { scoreByEdgeId: { get: () => { throw new Error('must not read') } } }
  const weight = createEdgeWeightFunction('fastest', routingConfig, { shade: throwingContext })
  expect(weight({ id: 'a:b:0', length: 42 })).toBe(42)
})
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- tests/javascript/exposureModel.test.js --run`

Expected: FAIL，原因是 Shade-aware 函数和第三个参数尚不存在。

- [ ] **Step 3: 实现公式且只复用 Base Exposure**

```js
export function calculateShadeAwareHeatExposure(edge, shadeContext, overrides = {}) {
  const config = { ...routingConfig, ...overrides }
  const baseHeatExposure = calculateEdgeHeatExposure(edge, config)
  const shadeScore = getEdgeShadeScore(shadeContext, edge.id)
  const value = (1 - config.shadeContributionWeight) * baseHeatExposure
    + config.shadeContributionWeight * (1 - shadeScore)
  return Math.min(1, Math.max(0, value))
}
```

`createEdgeWeightFunction` 必须先处理 Fastest 的 `lambda=0` 分支；只有 Balanced/Coolest 才读取 `environmentContext.shade`。Shade Context 为 `null` 时使用原 M5 Base Exposure，供明确的 UI 回退状态使用。

- [ ] **Step 4: 增加缺失 Edge、非法 Weight、边界值测试**

测试必须断言：缺失 score 明确抛错、`shade_score=0/1` 结果仍在 `[0,1]`、Cost 非负、Balanced/Coolest 在 Shade Context 有效时使用新 Exposure。

- [ ] **Step 5: 运行 Exposure 全套测试**

Run: `npm test -- tests/javascript/exposureModel.test.js tests/javascript/dijkstra.test.js --run`

Expected: PASS；Dijkstra 文件无修改。

- [ ] **Step 6: 提交 Exposure 检查点**

```bash
git add src/routing/exposureModel.js tests/javascript/exposureModel.test.js
git commit -m "feat: add shade-aware heat exposure formula"
```

### Task 3: Shade-aware Route Metrics

**Files:**
- Modify: `src/routing/routeMetrics.js`
- Modify: `src/routing/routeComparison.js`
- Test: `tests/javascript/routeExposureMetrics.test.js`
- Test: `tests/javascript/routeComparison.test.js`

**Interfaces:**
- Modifies: `calculateRouteMetrics(edgeSequence, speedOrConfig = routingConfig, environmentContext = null)`。
- Produces new metrics: `averageBuildingShadeScore`, `shadeAwareAverageHeatExposure`, `shadeAwareExposureLoad`, `modelledUnshadedDistance`, `shadeScenario`。
- Preserves existing metrics: `averageHeatExposure`, `modelledExposureLoad`, `greenIndicator`, `waterAccessIndicator`。
- Produces: `compareShadeAwareRouteToFastest(candidate, fastest)`。

- [ ] **Step 1: 写距离加权 Shade 指标 RED 测试**

```js
it('计算距离加权 Shade 与 Shade-aware Exposure', () => {
  const edges = [
    { id: 'a:b:0', length: 100, green_score: 0, water_penalty: 1 },
    { id: 'b:c:0', length: 300, green_score: 1, water_penalty: 0 },
  ]
  const shade = {
    scenario: '09:00',
    scoreByEdgeId: new Map([['a:b:0', 0], ['b:c:0', 1]]),
  }
  const metrics = calculateRouteMetrics(edges, routingConfig, { shade })
  expect(metrics.averageBuildingShadeScore).toBeCloseTo(0.75)
  expect(metrics.shadeScenario).toBe('09:00')
  expect(metrics.shadeAwareExposureLoad / metrics.distanceMeters)
    .toBeCloseTo(metrics.shadeAwareAverageHeatExposure)
})
```

- [ ] **Step 2: 写独立 Comparison RED 测试**

断言 `compareRouteToFastest()` 输出与现有快照完全一致；`compareShadeAwareRouteToFastest()` 独立输出 `shadeAwareExposureChange`、`shadeAwareExposureReductionPercent`、`shadeAwareLoadChange`、`shadeAwareLoadReductionPercent`，不向旧对象追加字段。

- [ ] **Step 3: 运行测试确认 RED**

Run: `npm test -- tests/javascript/routeExposureMetrics.test.js tests/javascript/routeComparison.test.js --run`

Expected: FAIL，原因是新签名和新指标尚未实现。

- [ ] **Step 4: 实现 Route Metrics 双轨字段**

每条 Edge 只读取一次 Shade Score；Base 指标仍调用现有 `calculateEdgeHeatExposure`，不得改变该函数。有效 Context 时累加 `edge.length × shadeScore`、`edge.length × shadeAwareExposure` 和 `edge.length × (1 - shadeScore)`；无 Context 时所有 Shade 字段返回 `null`，不得用 `0` 冒充有效 Shade。

- [ ] **Step 5: 实现独立 Shade-aware Comparison**

```js
export function compareShadeAwareRouteToFastest(candidate, fastest) {
  return {
    shadeAwareExposureChange:
      candidate.shadeAwareAverageHeatExposure - fastest.shadeAwareAverageHeatExposure,
    shadeAwareExposureReductionPercent: percentageReduction(
      fastest.shadeAwareAverageHeatExposure,
      candidate.shadeAwareAverageHeatExposure,
    ),
    shadeAwareLoadChange: candidate.shadeAwareExposureLoad - fastest.shadeAwareExposureLoad,
    shadeAwareLoadReductionPercent: percentageReduction(
      fastest.shadeAwareExposureLoad,
      candidate.shadeAwareExposureLoad,
    ),
  }
}
```

不得修改 `compareRouteToFastest()` 的返回字段或数值。

- [ ] **Step 6: 运行 Bundle 与 M5 回归测试**

Run: `npm test -- tests/javascript/routeExposureMetrics.test.js tests/javascript/routeComparison.test.js tests/javascript/m5RealTokyoCases.test.js --run`

Expected: PASS；M5 Real Tokyo Cases 在不传 Context 时保持原基线。

- [ ] **Step 7: 提交 Bundle 检查点**

```bash
git add src/routing/routeMetrics.js src/routing/routeComparison.js tests/javascript/routeExposureMetrics.test.js tests/javascript/routeComparison.test.js
git commit -m "feat: calculate shade-aware route metrics"
```

### Task 4: Routing Integration

**Files:**
- Modify: `src/routing/calculateRouteBundle.js`
- Modify: `src/shade/useShadeLayer.js`
- Modify: `src/routing/useRouteBundle.js`
- Modify: `src/App.jsx`
- Test: `tests/javascript/calculateRouteBundle.test.js`
- Test: `tests/javascript/useShadeLayer.test.jsx`
- Test: `tests/javascript/useRouteBundle.test.jsx`
- Test: `tests/javascript/App.test.jsx`

**Interfaces:**
- `calculateRouteBundle(graph, startId, destinationId, overrides = {}, shadeContext = null)` keeps existing four-argument compatibility。
- `useShadeLayer({ graph, loadShade })` returns `routingContext`, `createRoutingContext(scenario)` and `commitScenario(scenario)`。
- `useRouteBundle({ loadGraph = loadRoadGraph, loadShade = loadShadeData } = {})` continues to own Graph loading and internally composes `useShadeLayer` after Graph becomes ready。
- `useRouteBundle` exposes `shadeGeoJSON`, `shadeStatus`, `shadeScenario`, `changeShadeScenario`, `routingEnvironmentStatus` and `shadeAwareComparisons`。
- `App` consumes these fields from `routingState` and does not create a second Shade hook or scenario state。

- [ ] **Step 1: 写单一场景 Context RED 测试**

```js
it('候选场景 Context 与提交后的地图场景一致', async () => {
  const { result } = renderHook(() => useShadeLayer({ graph, loadShade }))
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(result.current.createRoutingContext('15:00').scenario).toBe('15:00')
  act(() => result.current.commitScenario('15:00'))
  expect(result.current.geoJSON.features[0].properties.scenario).toBe('15:00')
  expect(result.current.routingContext.scenario).toBe('15:00')
})
```

- [ ] **Step 2: 写 Bundle 注入与事务性重算 RED 测试**

Bundle fixture 使用一条短且无阴影路径和一条稍长但有阴影路径，断言：Fastest Edge Sequence 在有/无 Context 时完全一致；Balanced/Coolest 在固定 0.25 下读取 Shade；返回旧 `comparisons` 和独立 `shadeAwareComparisons`。Hook 测试覆盖：Graph 仍由 `useRouteBundle` 加载一次；已有路线从 09:00 切至 15:00 只重算一次；失败时保留旧场景与旧 Route Bundle；Route Card 切换不重算。

- [ ] **Step 3: 运行 Hook 测试确认 RED**

Run: `npm test -- tests/javascript/calculateRouteBundle.test.js tests/javascript/useShadeLayer.test.jsx tests/javascript/useRouteBundle.test.jsx tests/javascript/App.test.jsx --run`

Expected: FAIL，原因是 Routing Context 未暴露也未注入。

- [ ] **Step 4: 在现有 Route Hook 内组合 Shade 生命周期**

保留 `useRouteBundle` 现有 Graph `useEffect`、`graphRef`、Graph 状态和 Exposure Layer 代码。`useShadeLayer` 只在 `validateShadePayload` 成功后调用 `createShadeContext`；加载中或失败时 Context 为 `null`。`useRouteBundle` 内部调用该 Hook，并在 Context 为 null 时继续生成 Green/Water-only Route Bundle，同时暴露 `routingEnvironmentStatus: 'base-only'`，不得把结果标为 Shade-aware。

- [ ] **Step 5: 实现场景改变重算与失败回滚**

`useRouteBundle.changeShadeScenario(nextScenario)` 先通过 `createRoutingContext(nextScenario)` 得到候选 Context；路线已存在时以候选 Context 计算 Bundle，成功后才提交 Context、场景和 Routes，失败全部保留。无路线时只提交场景。`App` 删除独立 `useShadeLayer` 调用，直接把 Route Hook 暴露的 Shade props 传给 MapView。

- [ ] **Step 6: 运行 Hook 与交互回归**

Run: `npm test -- tests/javascript/calculateRouteBundle.test.js tests/javascript/useShadeLayer.test.jsx tests/javascript/useRouteBundle.test.jsx tests/javascript/App.test.jsx --run`

Expected: PASS。

- [ ] **Step 7: 提交状态接线检查点**

```bash
git add src/routing/calculateRouteBundle.js src/shade/useShadeLayer.js src/routing/useRouteBundle.js src/App.jsx tests/javascript/calculateRouteBundle.test.js tests/javascript/useShadeLayer.test.jsx tests/javascript/useRouteBundle.test.jsx tests/javascript/App.test.jsx
git commit -m "feat: recalculate routes for shade scenarios"
```

### Task 5: UI Scenario Sync

**Files:**
- Modify: `src/components/RouteDetails.jsx`
- Modify: `src/components/MapLayerControls.jsx`
- Modify: `src/components/ProductInfo.jsx`
- Test: `tests/javascript/RouteControls.test.jsx`
- Test: `tests/javascript/MapView.test.jsx`
- Test: `tests/javascript/App.test.jsx`

**Interfaces:**
- Consumes: `metrics.averageBuildingShadeScore`, `metrics.shadeAwareAverageHeatExposure`, `metrics.shadeScenario`。
- Consumes: `routingEnvironmentStatus: 'shade-aware' | 'base-only'`。
- Produces Japanese UI labels without changing internal English field names。

- [ ] **Step 1: 写日语 UI RED 测试**

断言当前选中路线详情只新增：`平均建物日陰スコア`、`日陰反映後の暑さ曝露スコア` 和当前时间；不得默认显示 `modelledUnshadedDistance`。场景控件显示 `この時刻の日陰条件を経路計算に反映`。Sidecar 失败时显示：`日陰データを利用できないため、緑・給水のみで計算しています`。

- [ ] **Step 2: 运行 UI 测试确认 RED**

Run: `npm test -- tests/javascript/RouteControls.test.jsx tests/javascript/MapView.test.jsx tests/javascript/App.test.jsx --run`

Expected: FAIL，原因是新指标文案尚不存在。

- [ ] **Step 3: 实现有限 UI 变化**

不重构 M6 页面，不修改 Route Card 默认字段。只在主 Route Detail 增加两个批准字段；`modelledUnshadedDistance` 和 `shadeAwareExposureLoad` 保留内部使用。Methodology 说明固定贡献比例 25%，并明确 Shade Score 来自秋分日离线预计算、不是实时日照或体感温度。

- [ ] **Step 4: 验证时间选择行为与无障碍标签**

`日陰条件` 下拉框继续使用 09:00/12:00/15:00；选择后地图图层和路线详情时间一致。加载中禁用选择；失败时不显示有效 Shade 指标。

- [ ] **Step 5: 运行 UI 回归测试**

Run: `npm test -- tests/javascript/RouteControls.test.jsx tests/javascript/MapView.test.jsx tests/javascript/App.test.jsx --run`

Expected: PASS。

- [ ] **Step 6: 提交 UI 检查点**

```bash
git add src/components/RouteDetails.jsx src/components/MapLayerControls.jsx src/components/ProductInfo.jsx tests/javascript/RouteControls.test.jsx tests/javascript/MapView.test.jsx tests/javascript/App.test.jsx
git commit -m "feat: show shade-aware route metrics"
```

### Task 6: Validation 与 Production 上线

**Files:**
- Modify: `README.md`
- Modify: `docs/DATA_SOURCES.md`
- Modify: `docs/PROJECT_OVERVIEW_JA.md`

**Interfaces:**
- Documents: fixed 0.25 formula, fixed scenarios, Sidecar source and limitations。
- Verifies: production build can load `graph.json`, environment data, drinking stations and `shade.json` under repository subpath。

- [ ] **Step 1: 更新文档**

README 和日语 Overview 说明：Fastest 不读 Shade Cost；Balanced/Coolest 使用固定 25% Shade Contribution；时间是秋分日离散场景；结果是 Modelled Heat Exposure，不是实时温度或医疗风险。DATA_SOURCES 保持 Project PLATEAU 官方来源、LOD Geometry Z Range 和 Sidecar 路径记录。

- [ ] **Step 2: 执行新增核心模块定向测试**

Run: `npm test -- tests/javascript/shadeContext.test.js tests/javascript/exposureModel.test.js tests/javascript/routeExposureMetrics.test.js tests/javascript/routeComparison.test.js tests/javascript/calculateRouteBundle.test.js --run`

Expected: PASS。按用户决定不执行全量测试和 jsdom Hook 测试。

- [ ] **Step 3: 执行正式构建**

Run: `npm run build`

Expected: PASS；`dist/data/graph.json` 和 `dist/data/shade.json` 均存在。

- [ ] **Step 4: 验证 Graph 与 M7 文件未变化**

实施前记录 `public/data/graph.json` SHA-256 和三个 M7 baseline 文件的 Git blob ID；此时重新计算并断言完全一致。这是文件不变性验收，不是参数搜索。

- [ ] **Step 5: 本地 Subpath QA**

使用 M8 已有 Pages Build Validation 验证 `/CoolRoute_Tokyo/` 下 JS/CSS、Graph、Environment、Drinking Station、Shade 全部返回有效内容；手动检查 09:00、12:00、15:00 切换会更新路线而 Fastest 不变。

- [ ] **Step 6: 检查提交范围**

Run: `git diff --cached --name-only`

Expected: 只包含 M10.5 代码、测试和相关文档；不得包含 `graph.json`、M7 baseline 或无关 M1 文档。

- [ ] **Step 7: 提交 M10.5**

```bash
git add README.md docs/DATA_SOURCES.md docs/PROJECT_OVERVIEW_JA.md
git commit -m "feat: add shade-aware routing"
```

- [ ] **Step 8: Push 后在线验收**

```bash
git push origin main
```

等待 GitHub Pages Artifact Workflow 成功后，实际访问 production URL，验证地图、三路线 Compare Mode、日语 UI、三时间场景、Shade Layer 和路线重算。在线验收失败时不进入 Tokyo Scale Expansion。

---

## Final Acceptance Checklist

- [ ] `shadeContributionWeight` 唯一正式值为 `0.25`，仓库不存在候选数组、搜索或自动推荐逻辑。
- [ ] Fastest 的单元测试和现有 M5/M7 回归测试证明其不读取 Shade，三个时间场景下的 Edge Sequence、Distance、Cost 均相同。
- [ ] Balanced/Coolest 的 Weight 与 Metrics 使用同一个 Shade Context 和同一 Exposure Formula。
- [ ] 时间下拉框、地图 Shade Layer、Route Detail 和 Routing Cost 使用同一场景 state。
- [ ] 未创建 90 OD 批量验证、候选权重数组、参数搜索或自动选参逻辑。
- [ ] `graph.json` 和 Graph Schema 1.1.0 的 Git diff 为零。
- [ ] M7 baseline 三文件的 Git diff 为零。
- [ ] 新增核心模块定向测试和 `npm run build` PASS；全量测试与 90 OD 验证按用户决定不执行。
- [ ] GitHub Pages 实际 URL 验收 PASS 后停止，不进入 M11。
