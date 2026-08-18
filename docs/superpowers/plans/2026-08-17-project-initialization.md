# CoolRoute Tokyo 项目初始化实施计划

> **供执行代理使用：** 必须使用子技能 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务执行本计划。步骤使用复选框（`- [ ]`）跟踪。

**目标：** 为 CoolRoute Tokyo 黑客松 Demo 建立仓库结构、持久化开发规则和不绑定具体实现的项目规格。

**架构：** 部署后的产品是托管在 GitHub Pages 上的静态 React + Vite + JavaScript 应用。离线 Python GIS 工具可预处理小范围区域数据，MapLibre 渲染和所有路线计算在浏览器中运行，不使用线上后端。

**技术栈：** React、Vite、JavaScript、MapLibre GL JS；可选离线 Python 预处理工具包括 GeoPandas、Shapely、OSMnx、NetworkX、Pandas 和 PyArrow。

**规格：** `PROJECT_SPEC.md`

## 全局约束

- 正式应用必须可完整部署到 GitHub Pages。
- 正式运行时不得依赖后端服务器、数据库、容器或线上 Python 运行环境。
- 不得伪造东京官方开放数据；数据源不可用时，必须通过适配器和缺失数据状态明确表达。
- 使用“Heat Exposure Score”、“Heat Exposure Index”和“热暴露评分”；不得将该指标表述为医疗风险或中暑概率。
- 项目初始化阶段不得实现完整寻路功能。

---

### 任务 1：建立持久化项目文档

**文件：**

- 创建：`AGENTS.md`
- 创建：`PROJECT_SPEC.md`
- 创建：`README.md`

**接口：**

- 输入：用户已批准的架构和术语约束。
- 输出：仓库级规则、产品范围和贡献者指引。

- [x] **步骤 1：创建 `AGENTS.md`，写入具有约束力的架构、数据真实性、术语、范围和稳定性规则。**
- [x] **步骤 2：创建 `PROJECT_SPEC.md`，覆盖目标、架构、用户流程、P0/P1/P2、数据流、评分定义、数据缺失行为和禁止的医疗声明。**
- [x] **步骤 3：创建 `README.md`，说明项目状态、架构、仓库目录、术语和无线上后端约束。**
- [x] **步骤 4：验证必需用语和约束。**

运行：

```bash
rg -n "GitHub Pages|Heat Exposure Score|Heat Exposure Index|热暴露评分|FastAPI|PostGIS|中暑概率" AGENTS.md PROJECT_SPEC.md README.md
```

预期：所有核心架构和术语约束均出现在对应文档中。

### 任务 2：创建最小仓库骨架

**文件：**

- 创建：`src/components/.gitkeep`
- 创建：`src/routing/.gitkeep`
- 创建：`src/utils/.gitkeep`
- 创建：`public/data/.gitkeep`
- 创建：`scripts/.gitkeep`
- 创建：`data/raw/.gitkeep`
- 创建：`data/processed/.gitkeep`
- 创建：`tests/.gitkeep`
- 创建：`docs/.gitkeep`
- 创建：`.github/workflows/.gitkeep`

**接口：**

- 输入：`README.md` 和 `PROJECT_SPEC.md` 中记录的目录边界。
- 输出：为后续单独批准的实现工作提供可跟踪的空目录。

- [x] **步骤 1：添加 `.gitkeep` 文件，确保每个必需空目录都可被跟踪。**
- [x] **步骤 2：确认没有引入应用、服务器、数据库、工作流或伪造数据实现。**
- [x] **步骤 3：输出排序后的最终目录树以便交接。**

运行：

```bash
find . -path './.git' -prune -o -print | sort
```

预期：存在指定目录结构、三份项目文档和本执行计划；不存在后端或业务实现文件。
