# CoolRoute Tokyo

**中文** | [日本語](README_JA.md) | [English](README_EN.md)

[在线体验](https://katenn0613.github.io/CoolRoute_Tokyo/) · [数据来源](docs/DATA_SOURCES.md) · [日语项目说明](docs/PROJECT_OVERVIEW_JA.md)

CoolRoute Tokyo 是一个面向东京高温步行环境的黑客松 Web 应用。它在地图上比较三种路线：

- **Fastest Route / 最短路线**：只以道路长度为成本；
- **Balanced Route / 平衡路线**：兼顾步行距离与模型热暴露；
- **Coolest Route / 凉爽优先路线**：赋予模型热暴露更高权重。

应用完全运行在浏览器中，通过 GitHub Pages 部署，不依赖线上后端、数据库或远程 Routing API。

> Heat Exposure Score（热暴露评分）是用于路线比较的模型估计指标，不是中暑概率、医疗风险或医学验证后的风险下降比例。实际环境可能与模型估计不同。

## 当前状态

- 正式范围：东京23区；
- Road Graph：409,472 个 Node；
- 原始有向 Edge：1,206,772 条；
- 行政区边界派生衔接 Edge：22 条；
- Production Edge 总数：1,206,794 条；
- Building Shade：Project PLATEAU，671 个 source mesh；
- 阴影场景：秋分日 09:00、12:00、15:00；
- Browser Graph Schema：`1.1.0`；Shade Schema：`1.0.0`。

## 使用方式

1. 在地图中点击选择出发点；
2. 再次点击选择目的地；
3. 浏览器计算并同时显示三种路线；
4. 点击 Route Card 切换当前突出路线；
5. 切换 09:00、12:00 或 15:00，将对应的预计算建筑阴影条件应用于 Balanced/Coolest。

点击位置必须处于 Tokyo23 配置范围内，并且距最近步行道路 Node 不超过 300 米。

## 模型

```text
baseHeatExposure
= 0.7 × (1 - green_score)
+ 0.3 × water_penalty

shadeAwareHeatExposure
= 0.75 × baseHeatExposure
+ 0.25 × (1 - shade_score)

Fastest:  distance
Balanced: distance × (1 + 1 × shadeAwareHeatExposure)
Coolest:  distance × (1 + 3 × shadeAwareHeatExposure)
```

Fastest 不读取 Shade。Balanced 与 Coolest 共用同一个浏览器端 Weighted Dijkstra，只通过 Weight Function 改变成本。

## 数据与架构

- React + Vite + JavaScript；MapLibre GL JS；
- Web Worker 中运行的浏览器端 Weighted Dijkstra；
- Road：OpenStreetMap walking network；
- Green：东京都官方「緑のオープンデータ（GISデータ）」；
- Water：Tokyowater Drinking Station；
- Building Shade：国土交通省 Project PLATEAU CityGML；
- 开发／构建阶段离线 GIS 处理；Production 是无后端的 GitHub Pages 静态站点。

浏览器只读取紧凑二进制 Graph、环境 metadata、GeoJSON 与 MVT，不直接解析 Shapefile、GraphML 或 CityGML。详细来源、许可证和处理规则见 [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)。

## 本地运行

```bash
npm ci
npm run dev
npm test -- --run
npm run build -- --base /CoolRoute_Tokyo/
```

Python GIS 环境：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m unittest discover -s tests/python -v
```

## 主要目录

```text
public/data/       浏览器静态 Production Data
src/components/    React UI 与 MapLibre 交互
src/routing/       Graph、吸附、Dijkstra 与路线指标
src/shade/         Shade Sidecar／图层逻辑
scripts/           离线 GIS 和数据构建脚本
tests/             测试与 synthetic fixture
docs/              数据、方法、评价和阶段文档
```

## 已知限制与后续改进

- Tokyo23 Road Graph 最初按行政区分别下载和简化，产生了区界拓扑断点。当前黑客松版本使用 11 组经距离筛选的双向派生连接，将覆盖超过 99.8% Node 的 12 个主要组件衔接起来；另外 8 个小型孤立组件保持原状。
- 派生连接只修复主要组件之间的近距离断裂，不代表对现实道路拓扑进行了完整证明。连接列表与规则记录在 [`topology_repair_tokyo23.json`](public/data/topology_repair_tokyo23.json)。
- 后续目标是使用统一 Tokyo23 Polygon 重新生成 OSM walking network，以正式道路拓扑替代临时区界衔接。
- `green_score` 是道路 15 米 Buffer 内实际绿色覆盖 Polygon 的比例代理值，不等于树荫。
- Building Shade 来自离线几何投影，不是实测阴影、道路温度或天气预报。Weather 不进入 Production。
- 本项目不声称道路数据、阴影条件或 Heat Exposure Score 能保证个人安全、预防疾病或提供医学验证收益。

## 数据真实性

项目禁止伪造东京官方开放数据。缺失数据必须明确标记，不会以 synthetic 数据替代 Production Data；synthetic fixture 只能用于测试。
