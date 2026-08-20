# M7 Route Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立基于当前 Production Graph 与正式浏览器路由实现的 90 组确定性分层 OD 评价管线，并生成可审计 JSON 与日语报告。

**Architecture:** Node.js 离线脚本读取 `public/data/graph.json`，复用 `prepareGraph()` 与 `calculateRouteBundle()`。抽样、逐 OD 记录、聚合统计、确定性序列化、验证和事务式发布分成小模块；正式算法、模型参数和 Graph Schema 保持只读。

**Tech Stack:** Node.js ES Modules、Vitest、现有 JavaScript Routing 模块、JSON、Markdown。

**Spec:** `docs/superpowers/specs/2026-08-21-m7-route-evaluation-design.md`

## Global Constraints

- Random Seed 固定为 `20260821`。
- Fastest Distance 分层固定为 `400 <= d < 1000`、`1000 <= d < 2000`、`2000 <= d <= 3500`，每层 30 组。
- 不依据路线重合、Heat Exposure 改善、Load 改善或 Extra Distance 接纳样本。
- 必须复用 `src/routing/graphLoader.js` 的 `prepareGraph()` 与 `src/routing/calculateRouteBundle.js` 的 `calculateRouteBundle()`。
- 不修改 Routing Algorithm、Exposure Formula、Weight、Lambda、Walking Speed、Graph Schema 或 Production Edge Score。
- 正式输出不得包含时间戳、运行耗时、本机路径或用户名。
- 只生成 M7 评价文件，不进入 M8。
- 最终只创建一个 Commit：`feat: add route evaluation pipeline`。
- `docs/superpowers/plans/2026-08-17-m1-map-and-data-sources.md` 的现有修改不得暂存、还原或覆盖。

---

## File Structure

- Create `scripts/evaluation/sampler.mjs`: 确定性 RNG、直线距离、分层与无结果偏向的 OD 接纳。
- Create `scripts/evaluation/evaluator.mjs`: 调用正式 Route Bundle，生成逐 OD 稳定记录。
- Create `scripts/evaluation/summary.mjs`: 分布、路线相同率、改善率和绕路阈值统计。
- Create `scripts/evaluation/serializer.mjs`: 浮点规范化、稳定 JSON 和日语报告渲染。
- Create `scripts/evaluation/validation.mjs`: Results、Summary 和发布前一致性验证。
- Create `scripts/evaluation/publisher.mjs`: 多目录临时文件、备份、替换与失败回滚。
- Create `scripts/evaluate_routes.mjs`: 正式 Graph 读取、SHA-256、90 OD 评价和三产物发布入口。
- Create `tests/javascript/evaluationSampler.test.js`: 抽样确定性、边界、配额、失败测试。
- Create `tests/javascript/evaluationEvaluator.test.js`: 正式 Route Bundle 记录契约测试。
- Create `tests/javascript/evaluationSummary.test.js`: 分布、改善与阈值分母测试。
- Create `tests/javascript/evaluationSerializer.test.js`: 数值、JSON、日语报告和回滚测试。
- Create `tests/javascript/evaluationProduction.test.js`: 正式产物完整性与可复算验证。
- Modify `tests/javascript/App.test.jsx`: 仅提高首屏用例超时，避免 M7 扩展测试套件后的 jsdom 并行资源竞争造成假失败。
- Modify `package.json`: 增加 `evaluate:routes` 命令。
- Create `evaluation/evaluation_results.json`: 90 组逐 OD 正式结果。
- Create `evaluation/evaluation_summary.json`: 聚合正式结果。
- Create `docs/EVALUATION_SUMMARY_JA.md`: 日语评价摘要。

---

### Task 1: Deterministic Stratified Sampler

**Files:**
- Create: `tests/javascript/evaluationSampler.test.js`
- Create: `scripts/evaluation/sampler.mjs`

**Interfaces:**
- Produces: `createSeededRandom(seed): () => number`
- Produces: `straightDistanceMeters(first, second): number`
- Produces: `classifyFastestDistance(distanceMeters): 'short' | 'medium' | 'long' | null`
- Produces: `sampleStratifiedOdPairs({ graph, calculateBundle, seed, targetPerStratum, maximumAttempts }): { cases, audit }`

- [x] **Step 1: Write failing sampler tests**

Use literal node fixtures and a deterministic fake `calculateBundle` whose Fastest distance depends only on the selected destination. Cover identical sequences for the same Seed, changed sequences for another Seed, string-ID sorting, exact stratum boundaries, no duplicate directed OD, 30/30/30 quotas, and quota exhaustion.

```js
expect(classifyFastestDistance(400)).toBe('short')
expect(classifyFastestDistance(1000)).toBe('medium')
expect(classifyFastestDistance(2000)).toBe('long')
expect(classifyFastestDistance(3500)).toBe('long')
expect(classifyFastestDistance(3500.001)).toBeNull()
```

Add a result-bias guard: return bundles with deliberately alternating route equality and exposure outcomes, then assert that accepted OD IDs remain unchanged when only those outcome fields are inverted.

- [x] **Step 2: Verify RED**

Run: `npm test -- --run tests/javascript/evaluationSampler.test.js`

Expected: FAIL because `scripts/evaluation/sampler.mjs` does not exist.

- [x] **Step 3: Implement minimal sampler**

Use the Numerical Recipes 32-bit LCG already used by the repository:

```js
state = (1664525 * state + 1013904223) >>> 0
```

Sort nodes by `String(node.id).localeCompare(...)`, draw two indices, apply straight-distance gates before routing, call the injected production-compatible bundle function, and make acceptance depend only on Start/Destination validity, directed uniqueness, connectivity, Fastest distance/ratio, and remaining stratum capacity. Record named rejection counts.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- --run tests/javascript/evaluationSampler.test.js`

Expected: all sampler tests PASS.

### Task 2: Per-OD Evaluation Record

**Files:**
- Create: `tests/javascript/evaluationEvaluator.test.js`
- Create: `scripts/evaluation/evaluator.mjs`

**Interfaces:**
- Consumes: existing `calculateRouteBundle(graph, startId, destinationId)` result.
- Produces: `sameEdgeSequence(first, second): boolean`
- Produces: `createEvaluationCase({ index, stratum, start, destination, straightDistanceMeters, bundle }): object`

- [x] **Step 1: Write failing evaluator tests**

Create a hand-written complete bundle containing Fastest, Balanced and Coolest route results. Assert exact field names, `edgeIds`, `totalCost`, route metrics, comparisons, and four equality flags. Assert timing fields and GeoJSON are excluded.

```js
expect(record.routes.fastest).toEqual({
  mode: 'fastest',
  distanceMeters: 500,
  walkingTimeSeconds: 500 / 1.4,
  edgeCount: 2,
  averageHeatExposure: 0.6,
  modelledExposureLoad: 300,
  greenIndicator: 0.2,
  waterAccessIndicator: 0.4,
  totalCost: 500,
  edgeIds: ['e1', 'e2'],
})
expect(record).not.toHaveProperty('totalCalculationTimeMs')
```

- [x] **Step 2: Verify RED**

Run: `npm test -- --run tests/javascript/evaluationEvaluator.test.js`

Expected: FAIL because evaluator exports are missing.

- [x] **Step 3: Implement minimal record builder**

Copy only the approved metrics and comparison fields. Define Green/Water change as `candidate - fastest`. Generate IDs as `m7-od-001` through `m7-od-090`.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- --run tests/javascript/evaluationEvaluator.test.js`

Expected: all evaluator tests PASS.

### Task 3: Summary Statistics

**Files:**
- Create: `tests/javascript/evaluationSummary.test.js`
- Create: `scripts/evaluation/summary.mjs`

**Interfaces:**
- Produces: `summarizeDistribution(values): object`
- Produces: `createEvaluationSummary(results): object`

- [x] **Step 1: Write failing distribution tests**

Use literal arrays with hand-derived results. Lock linear interpolation and null handling:

```js
expect(summarizeDistribution([0, 10, 20, 30])).toEqual({
  count: 4,
  nullCount: 0,
  min: 0,
  mean: 15,
  median: 15,
  p25: 7.5,
  p75: 22.5,
  p90: 27,
  max: 30,
})
```

Add fixtures where Average Exposure decreases but Load increases, where reductions are zero/negative, and where percentage values are null. Assert negative reductions are not counted as improvements.

- [x] **Step 2: Verify RED**

Run: `npm test -- --run tests/javascript/evaluationSummary.test.js`

Expected: FAIL because summary exports are missing.

- [x] **Step 3: Implement summary aggregation**

Compute sample counts, rejection audit, equality rates, absolute distributions for all modes, Balanced/Coolest comparison distributions, and threshold tables for `5/10/15/25%` distance and `1/3/5` minutes. Threshold improvement-rate denominators must be `eligibleCount`, with null rate when it is zero.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- --run tests/javascript/evaluationSummary.test.js`

Expected: all summary tests PASS.

### Task 4: Deterministic Serialization and Japanese Report

**Files:**
- Create: `tests/javascript/evaluationSerializer.test.js`
- Create: `scripts/evaluation/serializer.mjs`

**Interfaces:**
- Produces: `normalizeForOutput(value): unknown`
- Produces: `serializeJson(value): string`
- Produces: `renderJapaneseSummary(summary): string`

- [x] **Step 1: Write failing serializer tests**

Assert 12-decimal normalization, `-0` to `0`, preservation of null, rejection of non-finite numbers, two-space JSON with final newline, and byte-identical repeated output. Render a small literal Summary and assert the report includes the approved Japanese terminology, scope limitation and non-medical statement without asserting incidental whitespace.

- [x] **Step 2: Verify RED**

Run: `npm test -- --run tests/javascript/evaluationSerializer.test.js`

Expected: FAIL because serializer exports are missing.

- [x] **Step 3: Implement serializer and report renderer**

Recursively preserve object insertion order, normalize finite numbers through `Number(value.toFixed(12))`, throw on Infinity/NaN, and generate deterministic Markdown. Use `平均暑さ曝露スコア` and `モデル上の累積暑さ曝露`; explicitly state current-area/model limits and that results are not medical risk probabilities.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- --run tests/javascript/evaluationSerializer.test.js`

Expected: serializer/report tests PASS.

### Task 5: Validation and Transactional Publisher

**Files:**
- Modify: `tests/javascript/evaluationSerializer.test.js`
- Create: `scripts/evaluation/validation.mjs`
- Create: `scripts/evaluation/publisher.mjs`

**Interfaces:**
- Produces: `validateEvaluationResults(results, graph): void`
- Produces: `validateEvaluationSummary(results, summary): void`
- Produces: `publishFilesTransactionally(files, fsOverrides?): Promise<void>`

- [x] **Step 1: Add failing validation and rollback tests**

Build a three-case synthetic Results fixture, then mutate duplicate OD, stratum counts, missing edge IDs, out-of-range indicators, mismatched comparisons and wrong Graph hash. Each mutation must throw a specific error. For publisher rollback, create three old files in a temporary directory, inject a rename failure during the second replacement, and assert all old bytes are restored and no `.tmp`/`.bak` remains.

- [x] **Step 2: Verify RED**

Run: `npm test -- --run tests/javascript/evaluationSerializer.test.js`

Expected: FAIL because validation/publisher modules are missing.

- [x] **Step 3: Implement validation and publisher**

Validate the complete 90-case production contract while allowing small synthetic target counts through explicit expected strata in tests. Publisher writes same-directory unique temporary files, moves existing targets to backups, replaces each target, and on any failure restores all backups and removes newly created targets/temporary files.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- --run tests/javascript/evaluationSerializer.test.js`

Expected: validation and rollback tests PASS.

### Task 6: Production Entry Point

**Files:**
- Create: `scripts/evaluate_routes.mjs`
- Modify: `package.json`
- Create: `tests/javascript/evaluationProduction.test.js`

**Interfaces:**
- Entry command: `npm run evaluate:routes`
- Inputs: `public/data/graph.json`
- Outputs: `evaluation/evaluation_results.json`, `evaluation/evaluation_summary.json`, `docs/EVALUATION_SUMMARY_JA.md`

- [x] **Step 1: Write failing integration test**

Test the orchestration function against a small real-shaped synthetic Graph and a temporary output directory. Assert Graph SHA-256, config snapshot, false modification flags, exact sample quotas, no runtime metadata, and three fully generated texts.

- [x] **Step 2: Verify RED**

Run: `npm test -- --run tests/javascript/evaluationProduction.test.js`

Expected: FAIL because the entry module does not exist.

- [x] **Step 3: Implement production orchestration**

Export `buildEvaluationArtifacts({ graphText, outputPaths, samplingOverrides })` for integration testing. The CLI path reads the official Graph bytes, validates via `prepareGraph()`, snapshots `routingConfig`, samples with `calculateRouteBundle`, normalizes Results before Summary calculation, validates everything in memory, renders three texts, then publishes transactionally.

Update `package.json`:

```json
"evaluate:routes": "node scripts/evaluate_routes.mjs"
```

- [x] **Step 4: Verify GREEN**

Run: `npm test -- --run tests/javascript/evaluationProduction.test.js`

Expected: integration tests PASS without changing routing modules.

### Task 7: Generate and Audit Production Evaluation

**Files:**
- Create: `evaluation/evaluation_results.json`
- Create: `evaluation/evaluation_summary.json`
- Create: `docs/EVALUATION_SUMMARY_JA.md`

- [x] **Step 1: Run the formal evaluation**

Run: `npm run evaluate:routes`

Expected: 90 Cases, 30/30/30 strata, no sampling exhaustion, and all three files published.

- [x] **Step 2: Prove deterministic output**

Hash all three outputs, rerun `npm run evaluate:routes`, and hash them again.

Expected: every SHA-256 is identical before and after the second run.

- [x] **Step 3: Run production artifact test**

Run: `npm test -- --run tests/javascript/evaluationProduction.test.js`

Expected: formal files validate against current `public/data/graph.json` and contain no absolute path, runtime field, NaN or Infinity.

- [x] **Step 4: Inspect statistical claims**

Read `evaluation_summary.json` and `docs/EVALUATION_SUMMARY_JA.md`. Confirm every prose claim is directly supported by Summary and is limited to the current 90 OD/current model context.

### Task 8: Full Verification, Scoped Commit, and Push

**Files:**
- Modify/Create only the M7 files listed in this plan.
- Exclude: `docs/superpowers/plans/2026-08-17-m1-map-and-data-sources.md`

- [x] **Step 1: Run fresh verification**

Run:

```bash
npm run evaluate:routes
npm test -- --run
npm run build
git diff --check
```

Expected: evaluation succeeds, all Vitest tests PASS, Vite build exits 0, and no whitespace errors exist in M7 files.

- [x] **Step 2: Verify immutable boundaries**

Run `git diff --name-only d172f1cc7b2b00b527f3f2f6e6cd7e1559f117e8` and confirm no file under `src/routing/`, `src/config/routingConfig.js`, or `public/data/graph.json` changed.

- [x] **Step 3: Stage an explicit allowlist**

Stage only:

```text
package.json
scripts/evaluate_routes.mjs
scripts/evaluation/
tests/javascript/evaluation*.test.js
tests/javascript/App.test.jsx
evaluation/
docs/EVALUATION_SUMMARY_JA.md
docs/superpowers/specs/2026-08-21-m7-route-evaluation-design.md
docs/superpowers/plans/2026-08-21-m7-route-evaluation.md
```

Run `git diff --cached --name-only` and fail if the M1 plan appears.

- [x] **Step 4: Commit once**

Run: `git commit -m "feat: add route evaluation pipeline"`

- [x] **Step 5: Push main without force**

Run: `git push origin main`

- [x] **Step 6: Verify remote and working tree**

Confirm `origin/main` equals local HEAD, the latest subject is exact, and the only remaining worktree modification is the pre-existing M1 plan change.
