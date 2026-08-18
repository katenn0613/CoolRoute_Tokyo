# CoolRoute Tokyo

CoolRoute Tokyo 是一款用于比较东京高温环境下步行路线的黑客松 Web 应用。它将展示 **Fastest Route**、**Balanced Route** 和 **Coolest Route**，让用户比较步行时间与非医疗性的模型估计 **Heat Exposure Score**（热暴露评分）。

> **项目状态：** M6 日语优先 Demo UI 的实现、自动测试和正式构建已完成：三条路线默认同时显示，Balanced 默认高亮，Desktop 使用窄侧栏 + 主地图，Mobile 使用地图 + 可折叠 Bottom Sheet。Heat Exposure 与 Drinking Station 图层默认关闭。Browser Graph 仍为 M4 Schema `1.1.0`，路线计算继续完全在浏览器端运行，没有引入后端。当前执行环境没有可连接浏览器，1440×900、390×844 和 320 px 的真实渲染视觉验收仍待执行；CSS 断点与触控尺寸已完成静态审查。

## 架构概览

- 静态前端：React + Vite + JavaScript
- 地图：MapLibre GL JS
- 部署目标：GitHub Pages
- 寻路运行环境：浏览器端 JavaScript
- GIS 准备：只允许在开发或构建阶段运行离线 Python 脚本
- 正式运行后端：无
- 数据库：无

部署后的应用将从 `public/data/` 加载版本化的静态图结构和环境数据资源。它不会调用项目自建的寻路 API，也不需要服务器进程。

## 本地运行

```bash
npm install
npm run dev
```

执行测试和生产构建：

```bash
npm test -- --run
npm run build
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m unittest discover -s tests/python -v
```

测量正式 Road Graph 的本地 JSON 解析、索引和三条验收路线计算耗时：

```bash
npm run benchmark:routing
```

`npm run preview` 仅用于在本机检查静态构建结果，不是正式应用依赖的线上后端。

离线重新生成 OSM Graph：

```bash
.venv/bin/python scripts/build_osm_graph.py
# 仅需忽略完整缓存并重新请求时（旧 Raw 快照会归档保留）：
.venv/bin/python scripts/build_osm_graph.py --force-download
```

## Demo 区域

当前使用“皇居东侧—丸之内—东京站”临时 Demo 区域，中心点为 `[139.7575, 35.683]`，边界框为 `[139.744, 35.672, 139.771, 35.694]`。唯一坐标源是 `config/demo_area.json`，React 和 Python 均读取该文件。

## 仓库目录

```text
.
├── .github/
│   └── workflows/       # 未来的静态构建/部署工作流
├── data/
│   ├── processed/       # 开发阶段生成的 GIS 结果
│   └── raw/             # 带来源记录的本地原始输入
├── docs/                 # 设计和辅助文档
├── public/
│   └── data/            # 浏览器可读的静态运行时资源（含 graph.json）
├── scripts/              # 离线 OSM/GIS 预处理与验证
│   └── data_sources/     # 数据 Source Layer
├── src/
│   ├── components/      # React 展示和交互组件
│   ├── config/          # Demo 区域、地图样式与数据源 Registry
│   ├── routing/         # 浏览器端图结构与路径规划逻辑
│   └── utils/           # 职责单一的共享工具
├── tests/                # 确定性测试与已标注的合成 fixture
├── AGENTS.md             # 具有约束力的仓库开发规则
├── PROJECT_SPEC.md        # 产品范围、架构、数据流和声明政策
└── README.md              # 项目入口
```

## 数据政策

禁止伪造东京官方开放数据。每个已接入数据集都必须保留来源、已知许可证和覆盖范围信息。如果所需的真实数据源无法获取，应用必须暴露数据适配器的缺失状态，不得虚构数值或将占位内容标记为官方数据。

六个数据源的许可证、获取状态、路径和限制见 [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)。OpenStreetMap、M4 Green GIS 和 Drinking Station 均为 `ready`，其他数据为 `not_started`。

只有在清楚标记且与真实 Demo 数据分离时，测试 fixture 才可以是合成数据。

## 指标用语

必须使用 **Heat Exposure Score**、**Heat Exposure Index** 和 **热暴露评分**。这些值用于比较模型估计的路线暴露，它们不是 **中暑概率**、医疗风险分数或经医学验证的风险降低比例。

## M1 范围边界

M1 已实现 React/Vite 静态应用骨架、MapLibre 东京 Demo 地图、禁用状态的三路线控制面板、数据源状态展示、权威数据 Registry，以及只验证本地文件且不会自动下载的 Python Loader。

M1 没有实现 Dijkstra 或其他寻路算法、Heat Exposure Score 计算、GIS Spatial Join、PLATEAU 阴影模型、天气模型或真实数据下载。书面设计见 [M1 规格](docs/superpowers/specs/2026-08-17-m1-map-and-data-sources-design.md)。修改项目前必须先阅读 [PROJECT_SPEC.md](PROJECT_SPEC.md) 和 [AGENTS.md](AGENTS.md)。

## M2 道路图

M2 使用 OSMnx 2.1.1 获取真实 `walk` 网络，GraphML 缓存在 `data/raw/osm/`，浏览器 Graph 输出到 `public/data/graph.json`。M2 基线 Schema Version 为 `1.0.0`；M4 enrichment 后为 `1.1.0`，仍包含 5,350 个 Node 和 16,046 条有向 Edge；平行 Edge 和实际道路 geometry 均保留。

M2 不包含寻路算法、路线显示、Heat Exposure Score 或任何环境数据处理。详细设计见 [M2 规格](docs/superpowers/specs/2026-08-17-m2-osm-road-graph-design.md)。

## M3 Fastest Route

M3 从 GitHub Pages 兼容的静态路径加载 `public/data/graph.json`，在浏览器端完成以下闭环：

1. 第一次地图点击选择并吸附 Start，第二次选择并吸附 Destination；
2. Destination 确定后，使用 `edge.length` 作为唯一权重自动运行 Dijkstra；
3. 保留有向 MultiEdge 的具体 Edge，并拼接其真实 geometry 生成 GeoJSON；
4. 地图显示 Start、Destination、Fastest Route，以及距离、按 1.4 m/s 估算的步行时间和 Edge 数量；
5. `重新选择起点`、`重新选择终点` 使用事务式提交：新点无效或不可达时保留原路线；`Reset` 返回初始状态；
6. 路线生成后普通地图点击不会覆盖现有选择，`Find Route` 按钮保留用于重新计算。

当前只开放 Fastest。Balanced 和 Coolest 在界面中明确禁用，M3 没有 Heat Exposure 或环境权重逻辑。点击必须位于 Demo Area 内，且只会吸附到 200 m 内的 Road Graph Node。路线是否适合现实通行仍受 OSM 数据完整性和时效性限制。

M3 设计与验收边界见 [M3 规格](docs/superpowers/specs/2026-08-18-m3-fastest-route-design.md)。

## M4 环境 Edge Enrichment

M4 在离线 Python 构建阶段，以 EPSG:6677 为每条 Edge 增加：

- `green_score`：道路 15m Buffer 内由官方实际绿色覆盖 Polygon 估算的绿色覆盖比例代理值；
- `water_penalty`：由 Edge Geometry 到最近官方 Drinking Station Point 的距离按统一阈值映射的离散 penalty；距离统计保存在环境 metadata，不扩张 Browser Edge Schema。

Green 只采用官方定义可证明实际绿色覆盖的 Polygon 白名单，并在求面积前 union 去重。它不是 Shade Score、树冠遮阴比例、实际道路温度或医疗热风险。路线附近饮水点数量是独立的未来指标，M4 不从 `water_penalty` 反推。正式运行只读取 `public/data/` 静态文件，没有引入后端。详见 [M4 规格](docs/superpowers/specs/2026-08-18-m4-environment-edge-enrichment-design.md) 与 [环境 metadata](public/data/environment_metadata.json)。

## M5 Heat Exposure 与三模式路由

M5 使用 `0.7 × (1 - green_score) + 0.3 × water_penalty` 计算 Edge Modelled Heat Exposure。Fastest 使用道路距离；Balanced 和 Coolest 分别使用 lambda 1 和 3，在同一个 Weighted Dijkstra 中权衡距离与累计 Modelled Exposure Load。

Heat Exposure Score 是单位距离上的平均模型环境强度；Modelled Exposure Load 是考虑路线长度后的累计代理量。两者不能混用。`Coolest` 表示更高权重偏向低模型热暴露的折中路线，不保证无条件全局最低 Exposure。详细公式、术语和限制见 [方法说明](docs/METHODOLOGY.md) 与 [M5 规格](docs/superpowers/specs/2026-08-18-m5-heat-exposure-routing-design.md)。

## M6 日语产品界面

M6 将技术 Demo 重构为日语优先的 Compare 界面。地图始终保留三条真实 Route Geometry，未选路线降低透明度，当前路线通过独立顶层图层突出显示；切换 Route Card 只切换呈现状态，不会重新执行 Dijkstra。默认及 Reset 后选中 `balanced`。

Heat Exposure Layer 复用 M5 唯一的 Edge Exposure Model，只负责将正式 Edge 转换为 GeoJSON；Drinking Station Layer 读取静态 GeoJSON。两层默认关闭，且位于路线图层下方。正式 UI 将 Average Heat Exposure 显示为 `平均暑さ曝露スコア`，将 Modelled Exposure Load 显示为 `モデル上の累積暑さ曝露`。详细设计见 [M6 规格](docs/superpowers/specs/2026-08-18-m6-japanese-product-ui-design.md)。
