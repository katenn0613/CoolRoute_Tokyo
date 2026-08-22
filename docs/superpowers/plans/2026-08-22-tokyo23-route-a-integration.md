# Tokyo23 Route A Experimental Runtime Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前主线中接入已提交的 Tokyo23 Binary/Worker/MVT 实验 Runtime，并保持 Core5 为正式默认及 fallback。

**Architecture:** Tokyo23 使用 Worker 内的 TypedArray Graph 和 Binary Dijkstra；地图环境层使用静态 MVT。当前 React 页面结构、模型公式和 Core5 JSON Loader 保持不变，通过 Dataset Config 选择运行时。

**Tech Stack:** React、Vite、JavaScript、MapLibre GL JS、Web Worker、TypedArray、Vitest、GitHub Pages。

**Spec:** `docs/superpowers/specs/2026-08-22-tokyo23-route-a-integration-design.md`

## Global Constraints

- 不修改 Fastest、M5 Base Exposure、M10.5 Shade-aware Formula 或 lambda。
- 不删除 Core5 Production Assets。
- 不提交/加载旧的缺失版 `graph_tokyo23.json`。
- 不声称20个弱组件之间可达。
- Runtime 仍为 GitHub Pages 完全静态资源，无 Backend/Database。

---

### Task 1: Binary Graph 与 Routing Worker

**Files:**
- Create: `src/routing/binaryGraph.js`
- Create: `src/routing/binaryRouting.js`
- Create: `src/routing/route.worker.js`
- Create: `src/routing/routeEngine.js`
- Test: `tests/javascript/binaryRouting.test.js`

- [ ] 先写 Decoder、Nearest Node、MultiEdge、三模式与非法 Binary 的失败测试。
- [ ] 确认测试因模块缺失失败。
- [ ] 移植最小 Binary/Worker 实现，复用现有 Exposure/Comparison/Metrics。
- [ ] 运行 Binary 定向测试并提交。

### Task 2: Tokyo23 Runtime Assets 与 Metadata

**Files:**
- Create: `public/data/graph_tokyo23.bin`
- Create: `public/data/graph_tokyo23.bin.gz`
- Create: `public/data/graph_tokyo23_runtime_metadata.json`
- Create: `public/data/shade_metadata_tokyo23.json`
- Create: `public/data/tiles/heat/**`
- Create: `public/data/tiles/shade/**`
- Modify: `scripts/validate_pages_build.mjs`
- Test: `tests/javascript/pagesBuildValidation.test.js`

- [ ] 写失败测试，要求 Binary Header 数量、Runtime Metadata、MVT manifest 和 Core5 fallback 同时存在。
- [ ] 确认旧 Validator 无法通过。
- [ ] 从远程分支导入已审计 Runtime Assets，生成诚实的组件/来源 metadata。
- [ ] 扩展 Pages Validator 并提交。

### Task 3: Dataset Config、Hook 与 MVT UI

**Files:**
- Create: `src/config/tileConfig.js`
- Modify: `src/config/demoArea.js`
- Modify: `src/config/dataSources.js`
- Modify: `src/routing/useRouteBundle.js`
- Modify: `src/components/MapView.jsx`
- Modify: `src/App.jsx`
- Test: `tests/javascript/App.test.jsx`
- Test: `tests/javascript/MapView.test.jsx`
- Test: `tests/javascript/useRouteBundle.test.jsx`

- [ ] 写失败测试，要求 Core5 保持默认、Tokyo23 显式使用 Binary Dataset、Core5 fallback 保留、场景切换触发 Worker 重新路由。
- [ ] 确认当前 JSON Hook 不能满足测试。
- [ ] 接入 Worker Engine 和 MVT Sources，不覆盖现有 UI 层级与日语术语。
- [ ] 运行定向测试并提交。

### Task 4: 验证、文档和部署

**Files:**
- Modify: `README.md`
- Modify: `README_JA.md`
- Modify: `README_EN.md`
- Modify: `docs/DATA_SOURCES.md`

- [ ] 验证 Binary Header/Bounds/20 Components、10组成功 OD 与跨组件明确失败。
- [ ] 运行相关 JavaScript 测试、完整测试、Vite Subpath Build 和 Pages Validator。
- [ ] 同步三语范围/限制文档，不将东京23区称为整个东京都。
- [ ] 提交、合并 `main`、Push，并验收 GitHub Pages URL。
