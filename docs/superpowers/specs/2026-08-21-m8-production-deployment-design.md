# CoolRoute Tokyo M8 Production Deployment 设计规格

**里程碑：** M8 Production Deployment
**状态：** 已批准并实施
**M7 基线：** `062ecf9ca912389f5da430c5af18db6a78123f8f`
**Repository：** <https://github.com/katenn0613/CoolRoute_Tokyo>
**目标 URL：** <https://katenn0613.github.io/CoolRoute_Tokyo/>

## 1. 目标与完成边界

M8 将当前已完成 M0–M7 的 CoolRoute Tokyo Demo 部署为 GitHub Pages Production Site。使用者打开公开 URL 后，无需安装软件、登录账号或连接项目后端，即可在当前 Demo Area 内选择 Start/Destination，并比较 Fastest、Balanced、Coolest 三条路线。

M8 完成必须同时满足：

1. GitHub Pages Site 已启用，Publishing Source 为 GitHub Actions；
2. `main` Push 自动触发可重复的测试、构建、Artifact 上传和 Pages 部署；
3. Production Build 在 Repository Subpath 下正确运行；
4. Road Graph、Environment Metadata 和 Drinking Station GeoJSON 均能从 Pages URL 读取；
5. 真实线上页面完成 Desktop/Mobile 基本布局与地图路线闭环验收；
6. README、DATA_SOURCES 和日语 Project Overview 记录真实部署状态；
7. 指定 M8 Commit 已 Push 到 `origin/main`；
8. 停止，不进入 M9 或 M10。

## 2. 范围限制

M8 保持当前“皇居东侧—丸之内—东京站”Demo Area，不修改：

- Road Graph Node/Edge；
- Graph Schema `1.1.0`；
- Green/Water Edge Fields；
- Heat Exposure Formula；
- Routing Weight 或 Lambda；
- Weighted Dijkstra；
- Fastest/Balanced/Coolest Route Bundle；
- 日语 Compare Mode 的产品行为。

M8 不加入：

- Tokyo Scale 数据；
- Building Shade；
- Weather；
- 后端服务器、数据库或 API；
- PWA、登录、账户或其他无关功能。

## 3. 采用的部署架构

采用 GitHub 官方 Pages Artifact Workflow：

```text
Push main / workflow_dispatch
        ↓
Checkout
        ↓
Node 24 + npm ci
        ↓
npm test -- --run
        ↓
actions/configure-pages
        ↓
Vite build with configure-pages base_path
        ↓
Pages Build Validator
        ↓
actions/upload-pages-artifact
        ↓
actions/deploy-pages
        ↓
github-pages Environment
        ↓
Public URL
```

不采用 `gh-pages` Branch、第三方 Pages 发布 Action、提交 `dist/` 或从 `/docs` 目录直接发布。Production Artifact 由 Workflow 临时生成，Repository 只保存源代码、正式静态输入和部署配置。

## 4. GitHub Actions Workflow

新增：

```text
.github/workflows/deploy-pages.yml
```

Workflow 触发条件：

- Push 到 `main`；
- `workflow_dispatch` 手动触发。

Workflow 使用官方文档当前稳定 Major：

- `actions/checkout@v6`；
- `actions/setup-node@v6`；
- `actions/configure-pages@v5`；
- `actions/upload-pages-artifact@v4`；
- `actions/deploy-pages@v4`。

Node 固定为 `24`，依赖使用 `npm ci` 和 `package-lock.json`。Workflow 不运行 Python GIS 处理，不重新下载 OSM 或官方环境数据；它只验证并打包已经进入 `public/data/` 的轻量 Production Data。

Deploy Job 必须具有：

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

部署 Environment 固定为 `github-pages`，URL 来自 `actions/deploy-pages` 的 `page_url` 输出。使用 `concurrency.group = pages` 且 `cancel-in-progress = false`，防止进行中的 Production Deployment 被新 Push 中途取消。

## 5. Vite Base Path

M8 不在 `vite.config.js` 或业务模块中硬编码 Repository 名称。Workflow 中 `actions/configure-pages` 使用步骤 ID `pages`，Vite Build 读取其正式输出：

```bash
npm run build -- --base "${{ steps.pages.outputs.base_path }}/"
```

对当前 Project Site，`base_path` 预期为：

```text
/CoolRoute_Tokyo
```

Vite 因此把 `import.meta.env.BASE_URL` 编译为：

```text
/CoolRoute_Tokyo/
```

现有 `assetPath(relativePath)` 继续作为静态数据路径的唯一运行时入口。正式页面应请求：

```text
/CoolRoute_Tokyo/data/graph.json
/CoolRoute_Tokyo/data/drinking_stations.geojson
```

`environment_metadata.json` 当前不是浏览器路线计算的直接依赖，但必须随 Production Artifact 发布并可通过静态 URL 读取，作为数据来源与质量 metadata。

本地 `npm run build` 继续使用当前可移植的相对 Base；M8 Subpath QA 必须显式传入 `/CoolRoute_Tokyo/`，模拟实际 Project Pages，而不是只验证根路径。

## 6. Pages Build Validator

新增：

```text
scripts/validate_pages_build.mjs
tests/javascript/pagesBuildValidation.test.js
```

Validator 接受：

```text
--dist <directory>
--base-path <path>
```

职责：

1. 验证 Base Path 以 `/` 开头和结尾；
2. 验证 `dist/index.html` 中本地 JS/CSS/Worker 入口遵循指定 Subpath；
3. 验证 `dist/assets/` 存在且 HTML 引用目标实际存在；
4. 验证 `dist/data/graph.json` 存在、可解析、Schema 为 `1.1.0`、metadata count 与内容一致；
5. 验证每条 Production Edge 保留有效 `green_score` 和 `water_penalty`；
6. 验证 `dist/data/environment_metadata.json` 存在且可解析；
7. 验证 `dist/data/drinking_stations.geojson` 是有效 FeatureCollection；
8. 启动只绑定 `127.0.0.1` 随机端口的短生命周期静态服务器；
9. 从指定 Subpath 实际 HTTP 请求 HTML、Graph、Metadata 和 GeoJSON；
10. 验证错误根路径不会被误当成 Subpath 成功；
11. 完成后关闭服务器，不成为 Production Runtime 的一部分。

Validator 不修改 Production Data，不生成回退文件，也不启动长期运行的 Node Server。

测试至少覆盖：

- 正确 Subpath Build 通过；
- HTML 使用根路径 `/assets/...` 时失败；
- 缺少 Graph/Metadata/GeoJSON 时失败；
- Graph count 或 Schema 错误时失败；
- Environment Edge Fields 越界时失败；
- GeoJSON 类型错误时失败；
- Subpath HTTP 请求成功，根路径请求失败；
- Server 在成功或失败后均关闭。

## 7. Production Static Data Contract

GitHub Pages Artifact 必须包含：

| 文件 | Production 用途 | 验收 |
|---|---|---|
| `data/graph.json` | 浏览器端 Road Graph、Environment Edge Fields、Routing | HTTP 200、JSON 有效、5350 Nodes、16046 Edges、Schema `1.1.0` |
| `data/environment_metadata.json` | 官方环境数据来源、语义白名单与质量记录 | HTTP 200、JSON 有效 |
| `data/drinking_stations.geojson` | MapLibre Drinking Station Layer | HTTP 200、FeatureCollection、当前 Demo 点有效 |

不得把 Raw GraphML、Shapefile、CSV、GeoPackage 或 CityGML 加入 Pages Artifact。`data/raw/` 和 `data/processed/` 不是浏览器资源。

## 8. GitHub Pages Enablement

当前 Repository Pages API 返回 404，说明 Pages Site 尚未创建。M8 在 Workflow Push 前，通过已认证的 GitHub CLI/API 创建 Pages Site，并设置：

```text
build_type = workflow
```

这是用户已授权的 Production Deployment 外部状态变更。不得创建新 Repository、`gh-pages` Branch 或 Custom Domain。若 Site 已由其他操作创建，先读取现有状态并保持已有 URL，不盲目重复创建。

## 9. 文档更新

### 9.1 README

更新：

- 顶部加入 Live Demo URL；
- 项目状态更新为 M8 Production Deployment 完成；
- 说明 GitHub Pages Artifact Workflow；
- 记录 Production Build/Subpath 验证命令；
- 保持静态架构、无后端和 Demo Area 限制；
- 链接日语 Project Overview。

### 9.2 DATA_SOURCES

更新 `docs/DATA_SOURCES.md`：

- 增加 Production Distribution 章节；
- 记录 Pages 上三个轻量静态资源的 URL；
- 明确 Browser Artifact 与 Raw GIS 的边界；
- 将 Weather 标记为取消 Production 接入、仅 Future Work；
- 保持现有真实来源、许可证和语义白名单内容，不改写数据事实。

### 9.3 PROJECT_OVERVIEW_JA

创建：

```text
docs/PROJECT_OVERVIEW_JA.md
```

内容至少包括：

1. プロジェクト概要；
2. 対象エリア；
3. 最短/バランス/涼しさ優先の三路线；
4. 使用方法；
5. Average Heat Exposure 与 Modelled Exposure Load 的区别；
6. 使用数据与官方来源；
7. M7 评价结果；
8. GitHub Pages 静态架构；
9. 数据和模型限制；
10. 非医疗性声明。

日语术语继续使用：

- `平均暑さ曝露スコア`；
- `モデル上の累積暑さ曝露`；
- `モデル上の暑さ曝露`。

不得将指标描述为中暑概率、医疗风险或保证安全。

## 10. 实际线上验收

Workflow 成功后，必须验证真实 URL，而不是只看 Actions 绿色状态。

### 10.1 HTTP/资源验收

检查：

- 页面 URL HTTP 200；
- JS/CSS/MapLibre Worker HTTP 200；
- `data/graph.json` HTTP 200 且大小与内容合理；
- `data/environment_metadata.json` HTTP 200；
- `data/drinking_stations.geojson` HTTP 200；
- 无 `/assets/...` 或 `/data/...` 根路径 404。

### 10.2 Desktop 浏览器验收

在实际 Pages URL：

1. 页面显示日语标题与使用提示；
2. MapLibre 地图进入 Ready；
3. Start/Destination 可在 Demo Area 内选择；
4. 三条路线成功计算并同时显示；
5. 默认选中 Balanced；
6. Route Card 切换更新高亮和 Detail，不触发重新选点；
7. Fastest/Balanced/Coolest 指标可读；
8. Drinking Station Layer 可开启；
9. Reset 正常；
10. 没有应用资源加载错误。

### 10.3 Mobile 浏览器验收

使用约 390×844 Viewport 检查：

- 地图与 Bottom Sheet 可见；
- Bottom Sheet 可展开/折叠；
- Route Card 和主要按钮可操作；
- 选择/路线状态不会因折叠丢失；
- 页面无明显横向溢出。

实际道路路线是否完全符合现实临时通行情况不属于 Deployment QA；M8 只验证现有 M3–M7 功能在 Production Pages 环境没有被破坏。

## 11. 失败处理

- Workflow Tests 失败：停止 Deploy Job，不上传不完整站点；
- Subpath Validator 失败：停止部署，报告具体资源；
- Pages Site 未启用：通过授权 API 设置 Workflow Source，不伪造上线成功；
- Workflow 失败：读取 Actions Job 日志并修复明确原因；
- 页面或静态数据 404：优先检查 `base_path` 和 Artifact 内容；
- 外部 OSM Tile 暂时不可用：区分底图第三方网络问题与项目静态资源问题；
- 真实线上 QA 失败：M8 不完成，不进入 M9；
- 不使用 force push，不删除 Remote Branch，不重写历史。

## 12. Git 范围

M8 指定 Commit Message：

```text
feat: deploy CoolRoute Tokyo production site
```

M1 Plan 当前修改仅为六处意外 Markdown 行尾空格。实施前使用精确 Patch 恢复这些行，使文件与 HEAD 一致；该文件不得进入 M8 Commit。

M8 只暂存：

- Workflow；
- Pages Build Validator 与测试；
- M8 规格和实施计划；
- README；
- DATA_SOURCES；
- PROJECT_OVERVIEW_JA；
- 如验证命令需要，最小必要的 `package.json` Script。

Push 前必须通过 `git diff --cached --name-only` 检查范围。

## 13. 完成验证

本地与 CI 执行：

```bash
npm test -- --run
npm run build -- --base /CoolRoute_Tokyo/
node scripts/validate_pages_build.mjs --dist dist --base-path /CoolRoute_Tokyo/
```

M8 最终报告至少包含：

- Production URL；
- Pages Site 状态；
- Workflow Run URL 与结论；
- Commit SHA；
- Tests/Build/Subpath Validation；
- Graph/Metadata/GeoJSON 线上状态；
- Desktop/Mobile 验收；
- 已知限制；
- 工作区状态；
- 明确停止在 M8。
