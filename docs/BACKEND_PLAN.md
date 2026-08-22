# 后端化方案：前端只负责渲染地图

> 状态：**路线 A（无后端静态优化）已在本地实施完成**，见文末《路线 A 实施记录》。
> 路线 B（运行时后端）仍为提案。按 `AGENTS.md` 规定，路线 B 落地前必须先更新
> `PROJECT_SPEC.md` 的项目规格（见第 7 节）。
> 当前仓库前端 **已接入** Tokyo23 数据（提交 `fd75801`），并已切换到
> 二进制图 + Web Worker 路由 + MVT 瓦片图层。

---

## 1. 新增数据盘点（最近两次提交）

提交 `b96d4c3` + `818286f` 生成了 **東京23区（Tokyo23）生产数据集**：

| 文件 | 大小 | 内容 |
|---|---|---|
| `public/data/graph_tokyo23.json` | **78.4 MB** | OSM 步行路网，**111,574 节点 / 327,240 边**，schema 1.1.0 |
| `public/data/shade_tokyo23.json` | **12.5 MB** | PLATEAU 2020 阴影评分，3 个时段（09:00 / 12:00 / 15:00） |
| `public/data/drinking_stations_tokyo23.geojson` | 0.17 MB | 東京水道局饮水点 **567 个** |
| `public/data/environment_metadata_tokyo23.json` | 0.01 MB | 数据源 / 处理版本元数据 |
| `config/tokyo23_area.json` | — | 23 区边界、中心、PLATEAU 数据源 ID |

新增脚本：`scripts/tokyo23/`（download_sources / process_road / process_shade /
process_green / progress / validate_tokyo23），并扩展了 `scripts/build_environment_graph.py`、
`scripts/data_sources/plateau_source.py` 等。

### ⚠️ 新增 shade 数据存在质量问题（必须处理）

`shade_tokyo23.json` 的 **327,240 条边阴影评分全部为 0**（非零占比 0.00%）：
元数据 `quality` 记录 `validBuildingCount: 0, invalidBuildingCount: 1768233`。
对比小区域 demo（`shade.json`，70% 边有非零评分），说明 Tokyo23 的 PLATEAU 建筑网格
验证全部失败，阴影管线实际上**没有产出有效数据**。

按 `AGENTS.md` 数据真实性规则：这属于"官方数据获取/处理失败"，不得悄悄用全 0 数据
冒充有效阴影。接入前端前必须：
- 修复 `process_shade.py` 的网格验证/投影（LOD 高度源、无效 mesh 过滤），重新生成；或
- 明确把该数据集标记为 `unavailable`，前端显示"阴影数据不可用"状态，而不是渲染一条全 0 图层。

---

## 2. 实测瓶颈（Tokyo23 规模，Node 24 单线程基准）

| 环节 | 耗时 / 开销 | 说明 |
|---|---|---|
| 网络传输 | **~91 MB JSON** | 78.4 + 12.5，GitHub Pages 静态托管默认不压缩 |
| `JSON.parse` | ~0.8 s（主线程阻塞） | 两张大字符串 |
| Schema 校验 | ~1.1 s（阻塞） | `validateGraphPayload` + `validateShadePayload`，O(E) 且建 Set |
| `prepareGraph` | ~0.7 s（阻塞） | 建 nodes/edges/adjacency 三个 Map |
| 热暴露 GeoJSON 构建 | 88 ms → **77.3 MB**（327,240 features） | `buildExposureFeatureCollection` |
| 阴影 GeoJSON 构建 | 122 ms → **79.5 MB**（327,240 features） | `buildShadeFeatureCollection` |
| 阴影 context 重建 | ~335 ms / 每次场景切换 | `createShadeContext` 遍历全部边 |
| MapLibre 渲染 | **2 层 × 327k 线段 ≈ 160 MB 进 worker** | 缩放/平移掉帧；`setData` 每次都全量重传 |
| 点击吸附（暴力扫描 111k 节点） | 5–7 ms / 次 | O(N)，与图规模线性增长 |
| Dijkstra | 近距 1.4 ms / 远距 160 ms | 尚可，但每次计算 ×3 模式 |

**结论**：卡顿主要来自四件事——
1. **91 MB 原始 JSON 下载**（首屏慢）；
2. **主线程 ~2.6 s 的 parse+校验+prepare 阻塞**（demo 规模没问题，Tokyo23 规模占大头）；
3. **MapLibre 一次性灌入 65 万+ 线段 feature**（渲染和交互掉帧，这是"很卡"的主因）；
4. **每次交互重复全量工作**（场景切换重建 context + GeoJSON + setData，点击全图扫描吸附）。

---

## 3. 目标架构：前后端职责划分

```
┌──────────────────────────────┐
│ 前端 (React + MapLibre)      │  ← 只做：渲染、交互、展示
│  · 底图 / 瓦片请求           │
│  · 点击取坐标、放置 marker   │
│  · 绘制后端返回的路线        │
│  · 图层开关 / 场景切换(只换图层)│
└──────────────┬───────────────┘
               │ HTTP JSON / MVT
┌──────────────▼───────────────┐
│ 后端 (FastAPI)               │  ← 只做：计算、数据
│  · /api/snap   最近节点吸附   │
│  · /api/route  三路线计算     │
│  · /api/tiles  热/阴影像量切片│
│  · /api/poi    饮水点(可选)   │
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│ 离线预处理 (Python, 构建期)   │  ← 已存在，继续扩展
│  · OSM 路网构建(已完成)       │
│  · PLATEAU 阴影投影(需修复)   │
│  · 切片生成 / 压缩 / 校验     │
└──────────────────────────────┘
```

前端**不再持有**路网图、阴影表、Dijkstra、吸附扫描——它只发坐标、收结果、画图层。

---

## 4. 后端服务拆分：哪些东西单开一个后端

### 4.1 路由计算服务（核心，收益最大）

**`POST /api/route`**

```json
// 请求
{ "start": [139.7671, 35.6836], "destination": [139.7618, 35.6812], "shadeScenario": "12:00" }

// 响应（一次返回三种模式）
{
  "fastest":  { "geoJSON": {...LineString...}, "metrics": { "distanceMeters": 812, "durationSeconds": 585, "heatExposureScore": 0.42, "extraDistanceRatio": 0 } },
  "balanced": { "geoJSON": {...}, "metrics": {...} },
  "coolest":  { "geoJSON": {...}, "metrics": {...} },
  "metadata": { "graphVersion": "1.1.0", "shadeSchemaVersion": "1.0.0", "computedAt": "..." }
}
```

- 服务端常驻内存图（327k 边 Dijkstra 数十 ms 级），可后续升级 A* / CH；
- 三个模式共用一次搜索的代价模型（与现有 `exposureModel.js` 公式一致，Python 侧实现并单测对齐）；
- 阴影评分在服务端内存/索引中，场景切换只换权重，**不用重新下载或重建**；
- 前端从此不需要 `graph_tokyo23.json`（省 78 MB）与 `shade_tokyo23.json`（省 12.5 MB）。

### 4.2 最近节点吸附服务

**`GET /api/snap?lon=139.7671&lat=35.6836` → `{ "nodeId": "...", "lon": ..., "lat": ..., "distanceMeters": 12.3 }`**

- 服务端用空间索引（GeoPandas sindex / STRtree / 网格索引）把 O(111k) 暴力扫描变成 O(log N)；
- 前端点击地图 → 发坐标 → 拿到节点，不需要 nodes 表。

### 4.3 矢量切片服务（解决"渲染卡"）

- 离线或首次启动时把 **热暴露层** 和 **阴影层（3 个时段）** 切成 **MVT 矢量瓦片**：
  - 方案 A（无后端也能用）：预生成 PMTiles 单文件（如 `heat.pmtiles`、`shade-12.pmtiles`），
    静态托管，MapLibre `addSource({type:'vector'})` 按视野只拉当前瓦片；
  - 方案 B（有后端）：`GET /api/tiles/heat/{z}/{x}/{y}` 与
    `GET /api/tiles/shade/{scenario}/{z}/{x}/{y}`。
- 效果：前端渲染的数据量从 **160 MB → 当前视野几十 KB**，缩放平移丝滑；
- 阴影场景切换变成**换一个瓦片源**，不再重建 79 MB GeoJSON 再 setData。

### 4.4 饮水点 / POI（可选）

- 567 个点只有 0.17 MB，静态 GeoJSON 直接放 `public/data/` 即可，不必后端；
- 若以后 POI 变多（绿地、饮水、公共设施合并），再挪到 `GET /api/poi`。

### 4.5 保留在"构建期"的部分（本来就该离线）

- OSM 路网构建、PLATEAU 阴影投影、环境字段空间连接、图校验 → 现有 `scripts/` 继续承担；
- **新增**：瓦片生成、二进制紧凑图导出（若保留客户端兜底）、gzip/brotli 压缩。

---

## 5. 技术选型

| 组件 | 选型 | 理由 |
|---|---|---|
| 后端框架 | **FastAPI (Python)** | 与现有 GIS 栈（GeoPandas/Shapely/NetworkX/Pandas）同语言，复用预处理代码 |
| 寻路 | **NetworkX 或自定义 Dijkstra**（327k 边内存图） | demo 规模足够；后续可换 OSRM/GraphHopper |
| 空间索引 | GeoPandas `sindex` / shapely STRtree | 吸附 O(log N) |
| 瓦片 | MVT + PMTiles（构建期 tippecanoe 或 Python `mapbox_vector_tile`） | 前端只拉视野内瓦片 |
| 部署 | Render / Railway / Fly.io 免费档（demo 用） | 无服务器运维负担 |
| 压缩 | 静态资源 gzip/brotli；API 返回紧凑 JSON | 传输减 3–5× |

> 注意：`AGENTS.md` 目前只允许"GeoPandas/Shapely/OSMnx/NetworkX/Pandas/PyArrow"
> 作为 Python GIS 库，且禁止运行时 FastAPI。新增 MVT 库与运行时后端都需要规格变更（第 7 节）。

---

## 6. 前端改动范围（React 侧）

1. **删掉**：`loadRoadGraph`、`prepareGraph`、`validate*`、`buildExposureFeatureCollection`、
   `buildShadeFeatureCollection`、`createShadeContext`、`findNearestNode` 的浏览器调用
   （逻辑保留在仓库，可搬到后端 Python 实现）；
2. **新增**：`src/api/` 薄封装（`fetchRoute` / `fetchSnap`），超时与错误状态沿用
   `userMessages.js` 的用户可读文案；
3. **MapView**：热暴露/阴影层改为 `type:'vector'` 瓦片源（PMTiles 或后端 MVT）；
   路线层仍是 GeoJSON（后端返回的小 LineString）；
4. 交互时序：点击 → `snap` → 选点 → `route` → 画 3 条线；场景切换只换瓦片源 + 可选重算；
5. 状态机（`selectionMachine.js`）与 UI 基本不变，只换数据来源。

---

## 7. 对 GitHub Pages 静态约束的影响（必须先改规格）

`PROJECT_SPEC.md` §2.1 / §4 P0 明确规定：**正式运行时无任何 API、后端服务器、
数据库、容器；产物必须完全静态部署在 GitHub Pages**。

后端化与这条约束**直接冲突**，按 `AGENTS.md` 必须先更新规格。建议的二选一路线：

**路线 A —— 保留静态部署（推荐先做，改动最小）**
- 不引入运行时后端：PMTiles 瓦片 + 浏览器 Dijkstra 移到 **Web Worker** +
  紧凑二进制图（TypedArray，预计 91 MB → 15–25 MB）+ gzip；
- 仍满足 GitHub Pages 约束，`PROJECT_SPEC.md` 只需把"优化紧凑静态资源"从 P1 提前；
- 适合黑客松 Demo 优先稳定。

**路线 B —— 引入运行时后端（用户当前诉求）**
- 按第 4 节拆分，前端只渲染；`PROJECT_SPEC.md` 需修订为：
  - §2.1：正式运行环境 = 静态前端 + 可选托管后端（FastAPI）；
  - §4 P0：移除"不运行线上后端"，改为"前端不依赖后端也能显示底图，路由功能依赖后端"；
  - §2.2：Python 运行范围从"仅构建期"扩展为"构建期 + 后端运行时"；
  - §8 医疗表述等规则不变。
- 部署：GitHub Pages（前端）+ Render/Railway（后端），或整体迁移到能托管静态+API 的平台。

**建议：先做路线 A 的瓦片化 + Worker，若仍不够再上路线 B。**
两者共享瓦片生成这一最大收益点。

---

## 8. 分阶段实施计划

| 阶段 | 内容 | 预期效果 | 依赖 |
|---|---|---|---|
| **P0 前端急救（无后端）** | ① 热/阴影层切成 PMTiles；② Dijkstra+吸附移入 Web Worker；③ 图导出紧凑二进制 + gzip；④ 去掉主线程校验（校验移到构建期脚本） | 首屏 <3 s，渲染/交互流畅；主线程不再阻塞 ~2.6 s | 瓦片生成脚本 |
| **P1 后端化** | ① 规格变更（§7 路线 B）；② FastAPI：`/snap`、`/route`、`/tiles`；③ 前端 `src/api/` 接入；④ 删前端大图加载 | 前端完全不碰 91 MB 数据，只剩渲染 | P0 的瓦片产物 |
| **P2 打磨** | 路由缓存（LRU）、错误降级（后端挂了显示底图+提示）、请求取消（快速连点） | 体验稳定 | P1 |

**测试与数据真实性要求（不可跳过）**：
- 后端 `/route` 用现有 `tests/javascript/realTokyoRoutes.test.js`、`m5RealTokyoCases.test.js`
  的同一组真实东京用例做**前后端结果一致性对比**（Python 实现必须复现浏览器端代价模型）；
- 瓦片图层与现有点线图层在 Tokyo23 范围做像素级抽样比对；
- 阴影数据在修复 `process_shade.py` 前，按第 1 节标记为 `unavailable`，禁止全 0 冒充。

---

## 9. 风险

| 风险 | 应对 |
|---|---|
| 后端挂了 → 前端无路由可用 | 前端保留降级 UI（底图仍可用）；P2 做缓存与健康检查 |
| Python 代价模型与浏览器端不一致 | 用真实东京用例做双端一致性测试（P1 验收项） |
| 瓦片生成数据量大（Tokyo23 全 23 区） | 构建期一次性离线生成，PMTiles 单文件；按需分城区 |
| 免费托管冷启动 / 限流 | demo 规模足够；必要时降级到路线 A |
| 阴影数据全 0 | 必须先修复或标记 unavailable，见第 1 节 |

---

## 路线 A 实施记录（2026-08-22，本地完成）

### 目标

地图在 Tokyo23 数据下**能加载出来**且交互流畅，同时保持 GitHub Pages 静态部署约束
（`PROJECT_SPEC.md` §2.1 不变，无需改规格——这属于 P1"优化紧凑静态资源"）。

### 做了什么

| 环节 | 之前（Tokyo23） | 之后 |
|---|---|---|
| 网络传输 | graph JSON 78.4 MB + shade JSON 13.8 MB = **92 MB** | **9.3 MB**（`graph_tokyo23.bin.gz`） |
| 主线程初始化 | parse+校验+prepare ≈ **1.8 s 阻塞** + 构建 160 MB GeoJSON | **0 阻塞**：全部移入 Web Worker（实测解压+解码+邻接表 ≈ 82 ms） |
| 热暴露/阴影图层 | 2 层 × 327,240 条 LineString GeoJSON ≈ 160 MB 进 MapLibre | **MVT 矢量瓦片**（z10–z13，136 块，42.5 MB 静态文件，按视野按需下载） |
| 路由计算 | 主线程 Dijkstra（对象图） | Worker 内 TypedArray Dijkstra，三模式 ≈ **30–41 ms** |
| 点击吸附 | 主线程暴力扫描 111k 节点 | Worker 内扫描 ≈ **5 ms/次** |

### 新增 / 修改的文件

- `scripts/build_binary_graph.mjs` — 图 + 阴影 → 紧凑二进制（`npm run build:graph`）
- `scripts/build_route_tiles.mjs` — 热/阴影 → MVT 瓦片（`npm run build:tiles`）
- `src/routing/binaryGraph.js` — 二进制解码（TypedArray）
- `src/routing/binaryRouting.js` — CSR 邻接表 + 二进制 Dijkstra + 吸附
- `src/routing/route.worker.js` + `src/routing/routeEngine.js` — Worker 与客户端封装
- `src/config/tileConfig.js` — 瓦片源配置
- `src/routing/useRouteBundle.js` — 生产走 Worker 异步路径；测试注入的 legacy 同步路径保留
- `src/components/MapView.jsx` — 热/阴影层改用矢量瓦片；场景切换只改 paint 表达式
- `public/data/graph_tokyo23.bin` / `.bin.gz` / `shade_metadata_tokyo23.json` / `tiles/` — 构建产物
- `tests/javascript/binaryRouting.test.js` — 二进制 vs legacy 一致性（合成 + 真实 Tokyo23 抽查）
- `tests/javascript/buildRouteTiles.test.js` — 瓦片构建函数测试

### 一致性保证

- `binaryRouting.test.js` 在**真实 Tokyo23 数据**上验证：二进制 Dijkstra 与 legacy 对象图
  Dijkstra 在三种模式下路径、边数完全一致，距离仅差 Float32 亚毫米级量化误差。
- 全部 **213 个测试通过**（含原有 167 个 + 新增 46 个）。
- 代价模型公式（green 0.7 / water 0.3 / shade 0.25 / lambda 1·3）与 `exposureModel.js` 逐边对拍。

### 下一步

- 浏览器内实测确认首屏与交互（本记录以 Node 冒烟 + 生产构建验证为准）；
- 如需继续：路线 A 收尾（gzip 已内置，可加 PWA 缓存）；或按第 4 节启动路线 B 后端。
