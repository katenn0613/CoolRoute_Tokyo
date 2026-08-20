# M8 Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前 CoolRoute Tokyo Demo 通过 GitHub 官方 Pages Artifact Workflow 上线，并完成 Repository Subpath、正式静态数据和真实浏览器功能验收。

**Architecture:** GitHub Actions 在 `main` Push 后运行完整测试，通过 `actions/configure-pages` 取得动态 `base_path`，使用该路径构建 Vite Artifact，再由官方 Pages Actions 上传和部署。独立 Node Validator 在上传前对 `dist/`、静态数据及 Subpath HTTP 行为进行验证；部署后从真实 URL 验证资源、地图、路线和日语 Compare UI。

**Tech Stack:** GitHub Actions、GitHub Pages、React、Vite、JavaScript、Node.js 24、Vitest、MapLibre GL JS、GitHub CLI、浏览器 QA。

**Spec:** `docs/superpowers/specs/2026-08-21-m8-production-deployment-design.md`

## Global Constraints

- 使用 GitHub Pages Artifact Workflow，不创建 `gh-pages` Branch，不提交 `dist/`。
- Workflow 必须使用 `actions/configure-pages` 输出的 `base_path`。
- 不在业务代码、`vite.config.js` 或 Workflow 中硬编码 `/CoolRoute_Tokyo/`。
- 本地 Subpath QA 可以显式传入 `/CoolRoute_Tokyo/`，因为它是被测输入，不是 Production 配置。
- 保持当前 Demo Area、Routing Algorithm、Exposure Formula、Weight、Lambda、Graph Schema 和 Production Graph 不变。
- 不加入 Weather、Shade 或 Tokyo Scale。
- 正式应用仍为纯静态 GitHub Pages Site，不引入线上 Node Server 或后端。
- 恢复 M1 Plan 的六处意外行尾空格，使该文件不进入 Commit。
- 提交前必须检查 `git diff --cached --name-only`。
- 指定 Commit Message 为 `feat: deploy CoolRoute Tokyo production site`。
- Push 到 `origin/main` 后必须验证真实 Pages URL；完成后停止，不进入 M9/M10。

---

## File Structure

- Create `.github/workflows/deploy-pages.yml`: 测试、动态 Subpath Build、验证、Artifact 上传和 Pages 部署。
- Delete `.github/workflows/.gitkeep`: Workflow 目录不再为空。
- Create `scripts/validate_pages_build.mjs`: Production Artifact 和 Subpath HTTP Validator/CLI。
- Create `tests/javascript/pagesBuildValidation.test.js`: Validator 的确定性合成 Artifact 测试。
- Modify `README.md`: Live Demo、M8 状态、部署架构和验证命令。
- Modify `docs/DATA_SOURCES.md`: Production Distribution URL、Artifact/Raw 边界、Weather Future Work。
- Create `docs/PROJECT_OVERVIEW_JA.md`: 日语项目总览、使用方法、数据、评价与非医疗声明。
- Create `docs/superpowers/specs/2026-08-21-m8-production-deployment-design.md`: 已批准 M8 规格。
- Create `docs/superpowers/plans/2026-08-21-m8-production-deployment.md`: 本实施计划。
- Restore only `docs/superpowers/plans/2026-08-17-m1-map-and-data-sources.md`: 移除六处意外行尾空格，不产生最终 diff。

---

### Task 1: Restore the Unrelated M1 Whitespace

**Files:**
- Restore: `docs/superpowers/plans/2026-08-17-m1-map-and-data-sources.md`

**Interfaces:**
- Produces: 干净的 M1 文件，不供 M8 模块调用。

- [ ] **Step 1: Confirm the diff is whitespace-only**

Run:

```bash
git diff -- docs/superpowers/plans/2026-08-17-m1-map-and-data-sources.md
```

Expected: only six additions of Markdown line-end double spaces.

- [ ] **Step 2: Restore exactly those six lines with apply_patch**

Remove only the two trailing spaces after the six `运行：...` command lines. Do not use `git reset --hard`, `git checkout --`, or restore unrelated files.

- [ ] **Step 3: Verify M1 is clean**

Run:

```bash
git diff --exit-code -- docs/superpowers/plans/2026-08-17-m1-map-and-data-sources.md
```

Expected: exit 0 and no output.

### Task 2: Pages Build Validator Core

**Files:**
- Create: `tests/javascript/pagesBuildValidation.test.js`
- Create: `scripts/validate_pages_build.mjs`

**Interfaces:**
- Produces: `normalizeBasePath(value): string`
- Produces: `validatePagesBuild({ distDirectory, basePath, verifyHttp }): Promise<object>`
- Produces CLI: `node scripts/validate_pages_build.mjs --dist <path> --base-path <path>`

- [ ] **Step 1: Write the first failing Validator tests**

Create a temporary synthetic `dist/` containing:

```text
index.html
assets/app.js
assets/app.css
assets/maplibre-gl-worker-test.js
data/graph.json
data/environment_metadata.json
data/drinking_stations.geojson
```

Use literal HTML with `/demo-repo/assets/...` references and a minimal valid Browser Graph Schema `1.1.0`. Assert:

```js
expect(normalizeBasePath('/demo-repo')).toBe('/demo-repo/')
expect(normalizeBasePath('/demo-repo/')).toBe('/demo-repo/')
await expect(validatePagesBuild({
  distDirectory,
  basePath: '/demo-repo/',
  verifyHttp: true,
})).resolves.toMatchObject({
  basePath: '/demo-repo/',
  graph: { nodeCount: 2, edgeCount: 1, graphVersion: '1.1.0' },
  drinkingStationCount: 1,
})
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- --run tests/javascript/pagesBuildValidation.test.js
```

Expected: FAIL because `scripts/validate_pages_build.mjs` does not exist.

- [ ] **Step 3: Implement minimal base and artifact validation**

Implement:

- Base Path normalization and rejection of non-absolute paths;
- HTML local `src`/`href` extraction;
- enforcement that local emitted assets begin with the supplied Base Path;
- referenced asset existence checks;
- MapLibre Worker filename and bundle reference checks;
- `graph.json` validation through existing `validateGraphPayload()`;
- Environment Metadata object validation;
- Drinking Station FeatureCollection and coordinate validation.

Return stable validation statistics without timestamps or local absolute paths.

- [ ] **Step 4: Verify GREEN**

Run the same targeted Vitest command and require all first-round tests to pass.

### Task 3: Validator Failure Modes and Subpath HTTP

**Files:**
- Modify: `tests/javascript/pagesBuildValidation.test.js`
- Modify: `scripts/validate_pages_build.mjs`

**Interfaces:**
- Extends `validatePagesBuild()` to start and close a loopback-only temporary HTTP server when `verifyHttp = true`.

- [ ] **Step 1: Add failing parameterized tests**

Cover:

1. HTML root asset `/assets/app.js` rejected under `/demo-repo/`;
2. missing Graph rejected;
3. missing Environment Metadata rejected;
4. missing Drinking GeoJSON rejected;
5. Graph Schema/count/Edge environment field errors rejected;
6. invalid GeoJSON type or coordinates rejected;
7. Worker file missing or not referenced rejected;
8. Subpath HTTP endpoints return 200 with parseable bodies;
9. root `/` and root `/data/graph.json` return 404;
10. server closes in both success and injected failure paths.

- [ ] **Step 2: Verify RED**

Run the targeted test and confirm new cases fail for missing behavior, not fixture errors.

- [ ] **Step 3: Implement loopback server and cleanup**

Use `node:http` with host `127.0.0.1` and port `0`. Resolve requests only below normalized Base Path, prevent `..` traversal, map exact Base Path to `index.html`, and close the server in `finally`. Use native `fetch` for HTTP verification. This server is a short-lived validation fixture, never a Production Runtime.

- [ ] **Step 4: Verify GREEN**

Run the targeted Validator suite and require every failure-mode and cleanup assertion to pass.

### Task 4: GitHub Pages Artifact Workflow

**Files:**
- Create: `.github/workflows/deploy-pages.yml`
- Delete: `.github/workflows/.gitkeep`

**Interfaces:**
- Consumes: `package-lock.json`, `npm test -- --run`, Vite CLI, Validator CLI.
- Produces: GitHub Pages Artifact and `github-pages` Deployment.

- [ ] **Step 1: Write the Workflow**

Use:

```yaml
name: Deploy GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false
```

Build steps:

1. `actions/checkout@v6`;
2. `actions/setup-node@v6`, Node 24, npm cache;
3. `npm ci`;
4. `npm test -- --run`;
5. `actions/configure-pages@v5` with ID `pages`;
6. `npm run build -- --base "${{ steps.pages.outputs.base_path }}/"`;
7. `node scripts/validate_pages_build.mjs --dist dist --base-path "${{ steps.pages.outputs.base_path }}/"`;
8. `actions/upload-pages-artifact@v4` with `path: dist`.

Deploy Job must `need` Build, use `github-pages` Environment and `actions/deploy-pages@v4` with step ID `deployment`.

- [ ] **Step 2: Perform Workflow static review**

Verify:

- no literal `/CoolRoute_Tokyo/` appears in Workflow;
- no `dist/` commit or `gh-pages` Branch operation;
- tests precede build and upload;
- Validator precedes upload;
- Deploy permissions and Environment are present;
- only official GitHub Actions are used.

### Task 5: Production Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/DATA_SOURCES.md`
- Create: `docs/PROJECT_OVERVIEW_JA.md`

**Interfaces:**
- Consumes: current M7 evaluation summary and M8 target URL.
- Produces: human-readable deployment and data documentation.

- [ ] **Step 1: Update README**

Add the Live Demo URL, M8 deployed status, Artifact Workflow overview, dynamic Base Path explanation, local Subpath validation commands, and Japanese Overview link. Preserve current M7 metrics and static/no-backend statements.

- [ ] **Step 2: Update DATA_SOURCES**

Add Production Distribution URLs for Graph, Environment Metadata and Drinking GeoJSON; state that only lightweight Browser Data ships to Pages. Change Weather wording from planned Production multiplier to cancelled Production feature/Future Work without claiming a weather dataset was integrated.

- [ ] **Step 3: Write PROJECT_OVERVIEW_JA**

Write concise Japanese sections for product purpose, Demo Area, three routes, usage, Average vs cumulative exposure, data sources, M7 evaluation, static deployment, limitations and non-medical disclaimer. Link to the Live Demo, DATA_SOURCES, METHODOLOGY and EVALUATION_SUMMARY_JA.

- [ ] **Step 4: Verify documentation**

Check all relative links exist, the Production URL is consistent, no medical claims appear, and no document claims Tokyo-wide coverage, Shade or Weather availability.

### Task 6: Local Test, Build, and Subpath QA

**Files:**
- Verify all M8 files and generated `dist/` only.

- [ ] **Step 1: Run targeted Validator tests**

```bash
npm test -- --run tests/javascript/pagesBuildValidation.test.js
```

- [ ] **Step 2: Run the complete JavaScript suite**

```bash
npm test -- --run
```

Expected: all files and tests PASS with exit 0.

- [ ] **Step 3: Build the exact Project Pages Subpath locally**

```bash
npm run build -- --base /CoolRoute_Tokyo/
```

Expected: Vite exits 0 and emits `dist/`.

- [ ] **Step 4: Validate the built Artifact over Subpath HTTP**

```bash
node scripts/validate_pages_build.mjs --dist dist --base-path /CoolRoute_Tokyo/
```

Expected: index/assets/Worker and all three static data resources PASS; root paths return 404 in the validator server.

- [ ] **Step 5: Audit immutable M8 boundaries**

Confirm no diff in:

```text
src/routing/
src/config/routingConfig.js
config/demo_area.json
public/data/graph.json
public/data/environment_metadata.json
public/data/drinking_stations.geojson
```

### Task 7: Enable Pages, Scoped Commit, and Push

**Files:**
- Stage only the M8 allowlist.

**Interfaces:**
- Mutates: GitHub Repository Pages configuration and `origin/main` as explicitly authorized.

- [ ] **Step 1: Inspect Pages state**

Use `gh api repos/katenn0613/CoolRoute_Tokyo/pages`. If 404, create it with `build_type=workflow`; if it exists, verify and preserve its URL/build type.

- [ ] **Step 2: Stage an explicit allowlist**

Stage only:

```text
.github/workflows/deploy-pages.yml
scripts/validate_pages_build.mjs
tests/javascript/pagesBuildValidation.test.js
README.md
docs/DATA_SOURCES.md
docs/PROJECT_OVERVIEW_JA.md
docs/superpowers/specs/2026-08-21-m8-production-deployment-design.md
docs/superpowers/plans/2026-08-21-m8-production-deployment.md
```

Include deletion of `.github/workflows/.gitkeep`. Do not use `git add .` or `git add -A`.

- [ ] **Step 3: Verify staged scope**

Run:

```bash
git diff --cached --check
git diff --cached --name-only
```

Fail if the M1 Plan, Routing, Demo Area or Production Data appears.

- [ ] **Step 4: Commit once**

```bash
git commit -m "feat: deploy CoolRoute Tokyo production site"
```

- [ ] **Step 5: Push main without force**

```bash
git push origin main
```

Use HTTP/1.1 only if the previously observed GitHub HTTPS transport issue recurs. Do not force push.

### Task 8: Monitor Deployment and Verify Production

**Files:**
- No local code changes unless a verified deployment defect requires a new TDD fix.

- [ ] **Step 1: Locate and monitor the exact Workflow Run**

Find the run associated with the M8 Commit SHA. Wait for Build and Deploy jobs to complete. Record Run URL, Deployment URL and conclusion. If it fails, inspect exact job logs before changing code.

- [ ] **Step 2: Verify production HTTP resources**

Request:

```text
https://katenn0613.github.io/CoolRoute_Tokyo/
https://katenn0613.github.io/CoolRoute_Tokyo/data/graph.json
https://katenn0613.github.io/CoolRoute_Tokyo/data/environment_metadata.json
https://katenn0613.github.io/CoolRoute_Tokyo/data/drinking_stations.geojson
```

Require HTTP 200 and valid response bodies. Parse HTML asset URLs and verify each JS/CSS/Worker URL returns 200.

- [ ] **Step 3: Desktop browser QA**

Open the real Pages URL, wait for map Ready, select Start and Destination inside Demo Area, verify three routes and metrics appear, Balanced is selected, Route Card switching works, Drinking Station Layer toggles, Reset clears the route, and no project asset requests fail.

- [ ] **Step 4: Mobile browser QA**

Use approximately 390×844 viewport. Verify the map and Bottom Sheet, collapse/expand behavior, route cards/buttons, state preservation and no obvious horizontal overflow.

- [ ] **Step 5: Verify Git/remote final state**

Confirm local HEAD, `origin/main` and GitHub `main` SHA match; Pages reports `built`; working tree is clean; M8 Commit subject is exact.

- [ ] **Step 6: Stop at M8**

Report the Production URL, Workflow Run, online results, Commit SHA, tests/build/validator evidence and known limitations. Do not begin Weather, Shade, M9 or M10.
