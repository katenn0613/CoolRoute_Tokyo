# CoolRoute Tokyo M2 OSM 道路图实施计划

> **供执行代理使用：** 必须使用子技能 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务执行本计划。步骤使用复选框（`- [ ]`）跟踪。

**目标：** 从当前 Demo Area 获取真实 OpenStreetMap 步行网络，缓存为 GraphML，验证并导出浏览器 Graph Schema 1.0.0 的 `public/data/graph.json`。

**架构：** `config/demo_area.json` 同时服务 React 和 Python；现有 `OSMSource` 负责缓存优先的 OSMnx 获取；独立 `osm_graph` 模块负责无网络依赖的转换、验证和原子 JSON 输出；CLI 只编排这些模块。

**技术栈：** Python 3.12、OSMnx 2.1.1、NetworkX、Shapely、React 19、Vite 8、JavaScript。

**规格：** `docs/superpowers/specs/2026-08-17-m2-osm-road-graph-design.md`

## 全局约束

- 只处理真实 OpenStreetMap walking network，不处理环境数据或寻路。
- `network_type="walk"`、`simplify=True`、`retain_all=False`。
- GraphML 是真实缓存；默认缓存优先，`--force-download` 才强制重新请求。
- 不删除组件、节点或边来强行通过验证。
- Synthetic Graph 只能进入测试临时目录。
- `graphVersion="1.0.0"` 表示浏览器 Graph Schema Version。
- 只有 production Graph 全流程成功后才能将 OSM Registry 改为 `ready`。
- 当前目录不是 Git 仓库，因此本计划不执行 commit、branch 或 worktree 操作。

---

### 任务 1：共享 Demo Area 与依赖

**文件：**

- 创建：`config/demo_area.json`
- 创建：`scripts/demo_area.py`
- 创建：`requirements-dev.txt`
- 修改：`src/config/demoArea.js`
- 修改：`tests/javascript/config.test.js`
- 创建：`tests/python/test_demo_area.py`

**接口：**

- `load_demo_area(path: Path) -> DemoArea`
- `DemoArea.osmnx_bbox -> tuple[float, float, float, float]`
- React `demoArea` 保持 M1 对外结构不变。

- [x] **步骤 1：先写 Python 和 JavaScript 失败测试，断言两端读取同一 JSON，且 bbox 顺序为 west/south/east/north。**
- [x] **步骤 2：运行定向测试，确认因共享配置和 Python 模块缺失而失败。**
- [x] **步骤 3：创建 JSON、Python 验证器和 JS 适配器，并固定 OSMnx 开发依赖。**
- [x] **步骤 4：安装依赖并确认定向测试通过。**

### 任务 2：缓存优先的 OSM Source

**文件：**

- 修改：`scripts/data_sources/osm_source.py`
- 修改：`scripts/data_sources/source_utils.py`
- 创建：`tests/python/test_osm_source.py`

**接口：**

- `OSMSource.load_or_download(demo_area: DemoArea, force_download: bool = False) -> nx.MultiDiGraph`
- `OSMSource.load_cache() -> nx.MultiDiGraph`
- `OSMSource.download(demo_area: DemoArea) -> nx.MultiDiGraph`
- 缓存路径固定为 `data/raw/osm/osm_walking.graphml` 和 sidecar JSON。

- [x] **步骤 1：写失败测试，覆盖缓存优先、强制下载、无缓存失败不写文件和来源 metadata。**
- [x] **步骤 2：运行测试，确认现有 M1 `OSMSource` 缺少新接口。**
- [x] **步骤 3：最小实现缓存加载、显式 bbox 下载、GraphML 保存和失败包装。**
- [x] **步骤 4：运行 Source 测试和原有 M1 Loader 测试。**

### 任务 3：Graph 转换、验证和原子输出

**文件：**

- 创建：`scripts/osm_graph.py`
- 创建：`tests/python/test_osm_graph.py`

**接口：**

- `validate_osm_graph(graph, demo_area) -> GraphStatistics`
- `build_browser_graph(graph, demo_area, generated_at) -> dict`
- `validate_browser_graph(payload, demo_area) -> GraphStatistics`
- `write_browser_graph(payload, output_path) -> int`

- [x] **步骤 1：写 synthetic MultiDiGraph 失败测试，手工断言 Node/Edge、平行边、有向 geometry 和 schema metadata。**
- [x] **步骤 2：写非法长度、缺失端点、非弱连通、低重合率和异常远点的失败测试。**
- [x] **步骤 3：运行测试，确认因 `osm_graph` 模块缺失而失败。**
- [x] **步骤 4：实现转换、方向检查、容差边界验证、统计和原子写入。**
- [x] **步骤 5：运行 Graph 测试和全部 Python 测试。**

### 任务 4：CLI 与真实数据生成

**文件：**

- 创建：`scripts/build_osm_graph.py`
- 创建：`tests/python/test_build_osm_graph.py`
- 运行时生成：`data/raw/osm/osm_walking.graphml`
- 运行时生成：`data/raw/osm/osm_walking.metadata.json`
- 运行时生成：`public/data/graph.json`

**接口：**

- CLI：`python3 scripts/build_osm_graph.py [--force-download]`
- 成功时打印来源、缓存状态、统计和文件大小；失败时返回非零退出码。

- [x] **步骤 1：写失败测试，验证 CLI 编排函数在 Source 失败时不创建 production JSON。**
- [x] **步骤 2：实现只负责编排的 CLI。**
- [x] **步骤 3：运行 CLI 测试后执行真实 OSM 预处理。**
- [x] **步骤 4：对真实 GraphML 和 `graph.json` 再运行统一验证并记录统计。**

### 任务 5：状态、文档和回归验收

**文件：**

- 修改：`src/config/dataSources.js`
- 修改：`docs/DATA_SOURCES.md`
- 修改：`README.md`
- 修改：`docs/superpowers/plans/2026-08-17-m1-map-and-data-sources.md`
- 修改：本计划

- [x] **步骤 1：仅在真实导出成功后增加 `READY` 并把 OSM Registry 改为 `ready`。**
- [x] **步骤 2：记录真实获取时间、实际范围、版本、统计、缓存路径和 Schema Version。**
- [x] **步骤 3：运行 `.venv/bin/python -m unittest discover -s tests/python -v`。**
- [x] **步骤 4：运行 `npm test -- --run` 和 `npm run build`。**
- [x] **步骤 5：扫描范围边界，确认没有环境数据、Heat Exposure 或 Routing 实现，也没有 synthetic production Graph。**
