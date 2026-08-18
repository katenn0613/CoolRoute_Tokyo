# M6 Japanese Product UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 M5 技术 Demo 重构为日语优先、Desktop 主地图 + Mobile Bottom Sheet、默认三路线 Compare 的静态比赛产品。

**Architecture:** 保留 M5 Route Bundle、Exposure Model 和 Weighted Dijkstra，将三路线呈现、日语 Formatter、用户错误映射和地图环境图层拆成独立模块。MapLibre 使用三个低视觉权重路线背景层和一个永远位于顶层的 Selected Route Layer；Exposure Layer 只调用 M5 `calculateEdgeHeatExposure`。

**Tech Stack:** React 19、Vite 8、JavaScript、MapLibre GL JS 6、Vitest、Testing Library、静态 GitHub Pages 资源。

**Spec:** `docs/superpowers/specs/2026-08-18-m6-japanese-product-ui-design.md`

## Global Constraints

- Production UI 以日语为第一语言，不建立 i18n 系统。
- 内部 Route Enum 保持 `fastest`、`balanced`、`coolest`。
- 默认和 Reset 后 `selectedMode = balanced`。
- 不修改 M5 Exposure Formula、Weighted Dijkstra、Route Bundle Schema、Graph Schema 或正式数据。
- 不平移或修改真实 Route Geometry。
- Heat Exposure Formula 的唯一来源是 `src/routing/exposureModel.js`。
- 正式运行继续完全静态，不增加 API、服务器、数据库或远程 Routing。
- 当前目录不是 Git 仓库；执行步骤不包含无法完成的 commit，但每个任务仍独立完成 RED/GREEN 验证。

---

### Task 1: 日语呈现配置、Formatter 和用户错误边界

**Files:**
- Create: `src/config/presentationConfig.js`
- Create: `src/utils/formatters.js`
- Create: `src/routing/userMessages.js`
- Test: `tests/javascript/formatters.test.js`
- Test: `tests/javascript/userMessages.test.js`

**Interfaces:**
- Produces: `routePresentation[mode]`，包含 `label`、`color`、`dasharray`、`backgroundWidth`、`backgroundOpacity`、`selectedWidth`。
- Produces: `formatDistance(meters)`、`formatWalkingTime(seconds)`、`formatExtraWalkingTime(seconds)`、`formatScore(value)`、`formatPercent(value, options)`。
- Produces: `toUserRoutingMessage(error, context)`，只返回批准的日语消息。

- [x] **Step 1: 写 Formatter 失败测试**

  覆盖 `850 m`、`1.3 km`、`18分`、不足一分钟显示秒、有限百分比、`null/NaN/Infinity -> 比較不可`。

- [x] **Step 2: 运行定向测试确认 RED**

  Run: `npm test -- --run tests/javascript/formatters.test.js tests/javascript/userMessages.test.js`

- [x] **Step 3: 实现最小模块**

  `presentationConfig` 使用蓝/橙/紫等色盲可区分颜色，并为三模式配置实线、短虚线、长虚线。`toUserRoutingMessage` 按 Graph Load、Area/Snap、No Route、Invalid 和 Generic 分类，不返回原始 `error.message`。

- [x] **Step 4: 重跑定向测试确认 GREEN**

  Run: `npm test -- --run tests/javascript/formatters.test.js tests/javascript/userMessages.test.js`

### Task 2: Selection 默认模式与 Route Bundle Hook 职责重命名

**Files:**
- Move: `src/routing/useFastestRoute.js` → `src/routing/useRouteBundle.js`
- Modify: `src/routing/useRouteBundle.js`
- Modify: `src/routing/selectionMachine.js`
- Modify: `src/App.jsx`
- Move: `tests/javascript/useFastestRoute.test.jsx` → `tests/javascript/useRouteBundle.test.jsx`
- Modify: `tests/javascript/selectionMachine.test.js`

**Interfaces:**
- Produces: `useRouteBundle({ loadGraph } = {})`。
- Hook 返回现有 M5 Route Bundle 派生字段，并新增稳定 `roadGraph` 引用和 `isCalculating` 状态。
- `selectMode(mode)` 只 dispatch `ROUTE_MODE_SELECTED`，不得调用 `calculateRouteBundle`。

- [x] **Step 1: 修改测试以要求默认/Reset 为 Balanced、Hook 新命名和日语错误隔离**

  对 `calculateRouteBundle` 建立 spy，确认 Route Card 模式切换不会增加调用次数；保留重新选择失败不提交候选状态的回归测试。

- [x] **Step 2: 运行定向测试确认 RED**

  Run: `npm test -- --run tests/javascript/selectionMachine.test.js tests/javascript/useRouteBundle.test.jsx`

- [x] **Step 3: 完成重命名和最小状态修改**

  删除旧 Production/Test import。Graph 加载成功时通过 Hook 返回 `roadGraph: graphRef.current`；Graph 或交互异常经 `toUserRoutingMessage` 转换，技术 Error 仅供 `console.error`。

- [x] **Step 4: 重跑定向测试确认 GREEN**

  Run: `npm test -- --run tests/javascript/selectionMachine.test.js tests/javascript/useRouteBundle.test.jsx`

### Task 3: Route Card、详情、Trade-off 与正式信息面板

**Files:**
- Create: `src/components/RouteCard.jsx`
- Create: `src/components/RouteDetails.jsx`
- Create: `src/components/ProductInfo.jsx`
- Modify: `src/components/RouteControls.jsx`
- Delete: `src/components/DataStatus.jsx`
- Modify: `src/App.jsx`
- Modify: `tests/javascript/App.test.jsx`

**Interfaces:**
- `RouteCard({ mode, route, selected, onSelect })` 使用原生 Radio/Card 交互。
- `RouteDetails({ mode, metrics, comparison })` 独立显示 Average Heat Exposure 与 Modelled Exposure Load Trade-off。
- `ProductInfo()` 显示 `使用データ`、`計算方法` 和 Disclaimer，不显示 Ready/Pending。

- [x] **Step 1: 写 M6 UI 失败测试**

  断言 Production UI 中存在三种日语路线名、日语选点状态、路线指标、使用数据、计算方法和 Disclaimer；不存在中文按钮、`Data Status`、`Ready`、`Pending`、`Find Route`、`Reset`。

- [x] **Step 2: 写 Trade-off 失败测试**

  使用 Average Reduction 与 Load Reduction 不同的 fixture，断言主要句子只使用 `modelledExposureLoadReductionPercent`；`null` 显示 `比較不可`。

- [x] **Step 3: 运行 App 测试确认 RED**

  Run: `npm test -- --run tests/javascript/App.test.jsx`

- [x] **Step 4: 实现 Route Card、详情与 Product Info**

  使用统一 Formatter。路线卡切换调用 `selectMode`；不触发 `recalculate`。删除坐标 Debug 输入，改为自然日语的已选择/未选择状态，保留 Change 和 Reset 操作。

- [x] **Step 5: 重跑 App 测试确认 GREEN**

  Run: `npm test -- --run tests/javascript/App.test.jsx`

### Task 4: Heat Exposure GeoJSON 单一公式来源

**Files:**
- Create: `src/routing/exposureLayer.js`
- Test: `tests/javascript/exposureLayer.test.js`
- Modify: `src/routing/useRouteBundle.js`

**Interfaces:**
- Produces: `buildExposureFeatureCollection(graph, config?) -> GeoJSON FeatureCollection`。
- 每个 Feature 保留正式 Edge `id`、`heatExposure` 和原 `geometry`；函数调用 `calculateEdgeHeatExposure(edge, config)`。
- Hook 在 Graph 加载成功后只构建一次 `exposureGeoJSON`，模式切换不重建。

- [x] **Step 1: 写失败测试**

  使用 synthetic graph 检查 Feature 数、Geometry 未改变和属性值；mock `calculateEdgeHeatExposure` 或使用非默认 override，证明模块没有第二套硬编码公式。

- [x] **Step 2: 运行定向测试确认 RED**

  Run: `npm test -- --run tests/javascript/exposureLayer.test.js`

- [x] **Step 3: 实现 GeoJSON 转换并接入 Hook**

  不复制公式，不修改 Edge。对无效 Graph 明确抛出 TypeError；输出对象只供 MapLibre 呈现。

- [x] **Step 4: 重跑定向测试确认 GREEN**

  Run: `npm test -- --run tests/javascript/exposureLayer.test.js tests/javascript/useRouteBundle.test.jsx`

### Task 5: MapLibre 三路线四层 Compare 与环境图层

**Files:**
- Create: `src/components/MapLayerControls.jsx`
- Modify: `src/components/MapView.jsx`
- Modify: `src/App.jsx`
- Modify: `tests/javascript/MapView.test.jsx`

**Interfaces:**
- `MapView` 接收 `routes`、`selectedMode`、`exposureGeoJSON`，不再只接收单个 `routeGeoJSON`。
- Map Style Layer 固定添加顺序：Exposure、Drinking、Fastest、Balanced、Coolest、Selected。
- Source IDs 固定为 `heat-exposure`、`drinking-stations`、`route-fastest`、`route-balanced`、`route-coolest`、`route-selected`。
- `MapLayerControls` 管理 Heat/Drinking 两个默认关闭 Toggle。

- [x] **Step 1: 扩展 MapLibre Mock 并写失败测试**

  断言 Source/Layer 顺序、三条背景路线同时存在、Selected 最后添加、三模式 dasharray 不同、Marker 保持 DOM Overlay、两个环境图层默认 `visibility: none`。

- [x] **Step 2: 写切换失败测试**

  点击 Route Card 后只通过新 Props 更新 Selected Source 和 Paint；Heat/Drinking Toggle 调用 `setLayoutProperty`，不会重建 Map。

- [x] **Step 3: 运行定向测试确认 RED**

  Run: `npm test -- --run tests/javascript/MapView.test.jsx tests/javascript/App.test.jsx`

- [x] **Step 4: 实现固定 Z-order 和 Source 更新**

  Route Background 使用低透明度，Selected 使用最高线宽和不透明度；Exposure 使用薄线、低透明度和 `interpolate` 色阶；Drinking 使用 Circle Layer 和 `assetPath('data/drinking_stations.geojson')`。

- [x] **Step 5: 重跑 Map/UI 测试确认 GREEN**

  Run: `npm test -- --run tests/javascript/MapView.test.jsx tests/javascript/App.test.jsx`

### Task 6: Desktop 主地图、Mobile Bottom Sheet 与日文字体

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/styles.css`
- Modify: `tests/javascript/App.test.jsx`

**Interfaces:**
- `App` 持有 `sheetExpanded`，只影响 Mobile CSS class，不影响 Route Bundle。
- Mobile Toggle 使用 `aria-expanded` 和 `aria-controls="route-panel-content"`。

- [x] **Step 1: 写 Bottom Sheet 可访问性失败测试**

  断言按钮日语名称、`aria-expanded` 状态切换和路线状态不被清除。

- [x] **Step 2: 运行 App 测试确认 RED**

  Run: `npm test -- --run tests/javascript/App.test.jsx`

- [x] **Step 3: 实现响应式 CSS**

  Desktop 使用窄侧栏 + 主地图；Mobile 地图占满视口，Bottom Sheet fixed 到底部并限制最大高度。使用系统日文字体栈、`overflow-wrap`、最小 44 px 触控目标和 `:focus-visible`。

- [x] **Step 4: 重跑 App 测试确认 GREEN**

  Run: `npm test -- --run tests/javascript/App.test.jsx`

### Task 7: 文档、回归、浏览器验收与停止门禁

**Files:**
- Modify: `PROJECT_SPEC.md`
- Modify: `README.md`
- Modify: `docs/METHODOLOGY.md`
- Modify: `docs/superpowers/plans/2026-08-18-m6-japanese-product-ui.md`

**Interfaces:**
- 文档记录 M6 日语 Production UI、Compare 模式和图层语义；不改变 M5 数学定义。

- [x] **Step 1: 扫描 Production UI 文案**

  使用 `rg` 检查 `src/components`、`src/App.jsx`、`src/routing/userMessages.js` 中的中文 UI、旧英文开发文案、`最も涼しい`、混用的 `累積曝露` 和禁止医疗性表述；逐项判断技术内部文本与用户可见文本。

- [x] **Step 2: 运行完整自动测试**

  Run: `npm test -- --run`

- [x] **Step 3: 运行 Production Build**

  Run: `npm run build`

- [ ] **Step 4: 启动本地静态预览并做 Desktop 检查**

  使用 1440×900 左右视口检查首屏理解、地图主视觉、三路线/Legend、环境 Toggle、Start/Destination/Reset 和信息折叠区。

  阻塞记录：本地静态预览和资源 200 响应已验证，但当前会话可用浏览器列表为空，未进行截图式真实视觉验收。

- [ ] **Step 5: 做 Mobile 检查**

  使用 390×844 和至少 320 px 宽度检查 Bottom Sheet、按钮触控、日语换行、无横向溢出、地图操作与展开/收起。

  阻塞记录：已完成 760 px/380 px CSS 断点、320 px 最小宽度和 44 px 触控目标静态审查；因无可连接浏览器，未完成 390×844/320 px 真实渲染验收。

- [x] **Step 6: 进行独立代码审阅**

  审阅 M6 Spec 合规、用户文案准确性、Route Card 不重算、Exposure Formula 单一来源、Map Z-order 和静态部署约束；修复全部 Critical/Important。

- [x] **Step 7: 最终重新运行测试和构建**

  修复后重新执行 `npm test -- --run` 与 `npm run build`，记录确切通过数和非阻塞警告。

- [x] **Step 8: 更新计划复选框并停止**

  记录最终页面结构、核心日语文案、Route Card、Exposure/Drinking Layer、Desktop/Mobile 结果、测试、构建和已知限制。不得进入 M7。
