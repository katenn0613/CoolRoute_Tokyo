# CoolRoute Tokyo 数据源登记表

本文件是数据源的人类可读说明；前端代码使用 `src/config/dataSources.js` 中的 Registry。两者必须保持一致。

M1 建立来源、目录和 Loader 契约；M2 已获取真实 OpenStreetMap 步行道路图；M4 已完成真实官方绿色覆盖与饮水点的 Edge Enrichment。`pending` 表示等待后续里程碑，不表示获取失败。

## Production Distribution

M8 将浏览器所需的轻量数据随 GitHub Pages Artifact 发布：

- Road Graph: <https://katenn0613.github.io/CoolRoute_Tokyo/data/graph_tokyo_core5.json>
- Environment Metadata: <https://katenn0613.github.io/CoolRoute_Tokyo/data/environment_metadata_tokyo_core5.json>
- Drinking Stations: <https://katenn0613.github.io/CoolRoute_Tokyo/data/drinking_stations_tokyo_core5.geojson>
- Service Area: <https://katenn0613.github.io/CoolRoute_Tokyo/data/service_area_tokyo_core5.geojson>
- Building Shade: <https://katenn0613.github.io/CoolRoute_Tokyo/data/shade_tokyo_core5.json>

Production Browser 只读取这些 JSON/GeoJSON 静态资源。GraphML、Shapefile、CSV、GeoPackage 及其他 Raw GIS 只用于离线预处理，不进入 Pages Runtime。

## 概览

| 数据 | 发布机构 | 优先级 | 当前状态 | Raw Path |
|---|---|---:|---|---|
| OpenStreetMap Walking Network | OpenStreetMap contributors | P0 | `ready` | `data/raw/osm/` |
| 緑のオープンデータ（GISデータ） | 东京都都市整备局 | P0 | `ready` | `data/raw/green/` |
| Tokyowater Drinking Station | 东京都水道局 | P1 | `ready` | `data/raw/drinking_station/` |
| Tokyo Street Trees | 东京都建设局 | P2 | `not_started` | `data/raw/trees/` |
| Project PLATEAU 3D Buildings | 国土交通省 | P2 | `ready` | `data/raw/plateau/` |
| JMA Weather Data | 日本气象厅 | Future Work | `not_started` | `data/raw/weather/` |

## 1. OpenStreetMap Walking Network

- **发布机构：** OpenStreetMap contributors / OpenStreetMap Foundation
- **官方来源：** <https://www.openstreetmap.org/>
- **用途：** 建立 pedestrian / walking road network
- **获取方式：** M2 使用 OSMnx 2.1.1，按 `config/demo_area.json` 的 `boundingBox` 获取 `network_type="walk"` 的网络；默认读取缓存，`--force-download` 才重新请求，并在覆盖稳定缓存路径前将旧 Raw 快照移入 `data/raw/osm/archive/`
- **文件格式：** 真实缓存为 GraphML，来源 sidecar 为 JSON，浏览器 Graph 为 JSON
- **License：** ODbL，必须显示 attribution；详见 <https://www.openstreetmap.org/copyright>
- **获取时间：** 2026-08-17T13:53:11.945094Z
- **空间覆盖：** 请求边界 `[139.744, 35.672, 139.771, 35.694]`；实际 Node 范围 `[139.7440015, 35.672002, 139.7709959, 35.6939986]`，EPSG:4326
- **时间覆盖：** 获取时由 OSM/Overpass 提供的当前快照；各要素更新时间不同
- **本地位置：** Raw `data/raw/osm/osm_walking.graphml` 和 `osm_walking.metadata.json`；Browser `public/data/graph.json`
- **处理方法：** OSMnx `graph_from_bbox`，`network_type="walk"`、`simplify=True`、`retain_all=False`；保留每条 MultiDiGraph 有向/平行 Edge，geometry 转为 `[lon, lat]`
- **浏览器 Graph：** M4 后 Schema Version `1.1.0`；5,350 个 Node、16,046 条 Edge；M4 仅增加环境字段，M2 topology、MultiEdge、length 和 geometry 不变
- **当前状态：** `ready`，M2 真实 GraphML 与 M4 production `graph.json` 均验证通过
- **已知限制：** 只覆盖 Demo 边界，不代表整个东京；OSM 完整性和通行标签依赖社区贡献；Schema Version 不是 OSM 数据版本。

### M11 东京都心5区 Production

- **Browser 文件：** `public/data/graph_tokyo_core5.json`；服务边界为 `public/data/service_area_tokyo_core5.geojson`
- **覆盖：** 千代田区、中央区、港区、新宿区、文京区；60,983 个 Node、181,858 条有向 Edge
- **获取方法：** 五区真实 OSM 行政区 Polygon 先 union，再执行一次 OSMnx `graph_from_polygon(..., network_type="walk", simplify=True, retain_all=False)`；禁止按区拼接后裁掉组件
- **连通性：** 弱组件数 1；五区各自 Node/Edge 覆盖与跨区代表 Node 可达均通过
- **Schema：** `1.1.0`；保持 `id/source/target/length/geometry/green_score/water_penalty`，不写入 Shade
- **状态：** `ready`；43MB Enriched JSON，低于 90MB Production Gate；原 `graph.json` 保留为 Demo 基线
- **Tokyo23 诊断结论：** 旧文件按区下载后只保留最大弱组件，造成明显空间缺失，故不再作为 Production 默认数据

### M1 开发底图

M1 使用 `https://tile.openstreetmap.org/{z}/{x}/{y}.png` 进行正常交互式底图显示。底图可见不代表步行图数据已就绪。应用必须遵守 <https://operations.osmfoundation.org/policies/tiles/>，不预取、批量下载或隐藏 attribution。

## 2. 緑のオープンデータ（GISデータ）

- **发布机构：** 东京都都市整备局 都市づくり政策部緑地景観課
- **官方来源：** <https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d2000000024>；[官方定义书](https://data.storage.data.metro.tokyo.lg.jp/toshiseibi/green_teigisho.pdf)；[文件清单](https://data.storage.data.metro.tokyo.lg.jp/toshiseibi/green_filelist.pdf)
- **用途：** `green_score`，即“道路 15m Buffer 内由官方实际绿色覆盖 Polygon 估算的绿色覆盖比例代理值”
- **获取时间：** 2026-08-18；Raw SHA-256 见各目录 metadata 与 `public/data/environment_metadata.json`
- **格式 / CRS：** ESRI Shapefile ZIP，CP932，EPSG:6677；局部白名单缓存为 GeoPackage
- **License：** M4 使用的具体资源页面标注 CC BY；使用时保留发布机构与来源
- **空间 / 时间覆盖：** 官方东京 GIS 数据；本项目只读取当前 Demo Road Graph 周边。官方调查/制作时点以该数据集说明为准，不解释成实时植被
- **处理方法：** Raw 不修改；先查官方定义和真实 Schema，再按语义白名单局部读取；修复 7 个局部无效公共设施几何；用 100m 无损空间分片加速；每条 Edge 使用 EPSG:6677 的 15m Buffer；相交片段 union 后计算面积比例，避免重叠重复计数
- **当前状态：** `ready`
- **M11：** 已按相同语义白名单与 15m Buffer 规则扩展到 Core5 Graph，metadata 为 `public/data/environment_metadata_tokyo_core5.json`。

### Green Polygon 语义白名单

| 官方名称 | 官方定义摘要 | 纳入 | 理由 |
|---|---|---:|---|
| 樹林地 | 300㎡以上的一团树林 | 是 | 明确表示实际成片树林 |
| 崖線の樹林地 | 在“樹林地”范围和崖线范围内确认的树林 | 是 | 明确表示实际树林；union 消除与樹林地重复 |
| 自治体管理の樹林地 | 非公园等范围、由自治体管理的树林 | 是 | 明确表示实际树林；Demo 相交数为 0 也透明记录 |
| 公共施設の緑 | 公共设施区域内以航空照片为基础提取制作的绿色覆盖 | 是 | 明确表示影像提取的实际绿色覆盖 Polygon |
| 公園・緑地等、自然公園 | 公园、庭园、自然公园等区域 | 否 | 区域边界不等于实际绿色覆盖 |
| 法规、规划或条例指定的绿地区域 | 法规/规划指定区域 | 否 | 指定范围不等于实际绿色覆盖 |
| 水系 | 河川、运河、水道、湖沼等 | 否 | 水体不是当前实际绿色覆盖 Polygon |
| 街路樹 | Point / Line 街路树 | 否 | 不混入 Polygon 覆盖比例 |

`green_score` 不是 Shade Score、树冠遮阴比例、实际道路温度或医疗热风险。当前白名单不是官方数据集中所有“绿相关”图层的合并，也不声称穷尽东京全部植被。

## 3. Tokyowater Drinking Station

- **发布机构：** 东京都水道局
- **官方来源：** <https://catalog.data.metro.tokyo.lg.jp/dataset/t000019d0000000003>
- **用途：** Edge Geometry 到最近官方 Drinking Station Point 的距离，以及离散 `water_penalty`
- **获取方式：** 官方 CSV `tokyowaterdrinkingstation_250917.csv`，默认缓存，强制下载失败不会破坏已有 Raw
- **文件格式：** CSV，CP932；801 行坐标全部有效
- **License：** CC BY
- **本地位置：** Raw `data/raw/drinking_station/`；Processed `data/processed/drinking_station/`；Browser `public/data/drinking_stations.geojson`
- **处理方法：** 全部 801 个有效官方点参与最近距离计算；`<=100m → 0`、`<=300m → 0.3`、`<=500m → 0.6`、`>500m → 1`；浏览器 GeoJSON 只发布 Demo 内 5 个点
- **当前状态：** `ready`
- **M11：** `public/data/drinking_stations_tokyo_core5.geojson` 发布都心5区边界框内 158 个有效官方点；全部 801 个有效点继续参与最近距离计算。
- **已知限制：** `water_penalty` 不是饮水点数量。“路线附近 N 个点”必须在后续按 Route Geometry 与独立 configurable buffer 计算，不能由 penalty 反推，也不能表述为路线实际经过。

## 4. Tokyo Street Trees

- **发布机构：** 东京都建设局
- **官方来源：** <https://catalog.data.metro.tokyo.lg.jp/dataset/t000014d2000000029>
- **用途：** 未来 `tree_score` 候选输入
- **获取方式：** M1 不下载
- **文件格式：** CSV
- **License：** CC BY
- **本地位置：** Raw `data/raw/trees/`；Processed `data/processed/environment/`
- **处理方法：** 尚未实施
- **当前状态：** `not_started`，P2
- **已知限制：** 使用前必须验证 CSV 是否包含可用空间位置和 Demo 覆盖；统计数量不能代替树木地理点。

## 5. Project PLATEAU 3D Buildings

### M11 东京都心5区 Production

- **官方来源：** [Project PLATEAU 东京23区 2020](https://www.geospatial.jp/ckan/dataset/plateau-tokyo23ku)
- **Browser 文件：** `public/data/shade_tokyo_core5.json`，Shade Schema `1.0.0`
- **目标选择：** 只选择与 Core5 Service Area Polygon 的 500m 影响区相交的 126 个官方 Building mesh
- **处理策略：** 每个 mesh 下载、流式解析、生成 Edge interval shard、验证后立即删除 Raw GML；中断后读取 progress 并跳过已完成且 shard 存在的 mesh
- **正式高度：** Geometry Z Range；完整 LOD2 优先，否则整栋 LOD1 fallback；`measuredHeight` 只用于 QA
- **质量统计：** 126 个目标 mesh 全部完成；293,663 栋有效 Building、0 栋无效 Building；LOD2 29,561 栋、整栋 LOD1 fallback 264,102 栋
- **浏览器数据：** 约 7.9MB；Sidecar 精确覆盖 181,858 个 Road Edge ID，09:00 / 12:00 / 15:00 三个场景值域均为 `[0,1]`
- **发布门禁：** 126 个目标 mesh 必须全部完成，且 Sidecar 必须精确覆盖全部 Road Edge ID；不允许用零值伪装缺失 mesh

- **发布机构：** 国土交通省
- **官方来源：** [PLATEAU 千代田区 2023](https://www.geospatial.jp/ckan/dataset/plateau-13101-chiyoda-ku-2023)；Dataset ID `plateau-13101-chiyoda-ku-2023`
- **用途：** 当前 Demo Area 的 Building Geometry Height、固定太阳场景 Shadow Polygon、道路中心线建筑阴影比例，以及 M10.5 Balanced/Coolest Shade-aware Routing
- **获取方式：** 2026-08-21 通过 HTTP Range 只提取官方 ZIP 中覆盖 Road Graph 与 500m 影响边界的 14 个 `udx/bldg/*_bldg_6697_op.gml`，不下载或长期保存 1.95GB 完整 ZIP
- **文件格式 / CRS：** CityGML 2.0，EPSG:6697 XYZ；空间分析转换为 EPSG:6677；Browser Sidecar 为 JSON
- **License：** CC BY 4.0（Project PLATEAU Open Data；使用时保留国土交通省与具体数据集 attribution）
- **本地位置：** Raw `data/raw/plateau/`（Git ignored）；报告 `data/processed/shade/`；Browser `public/data/shade.json`
- **处理方法：** 流式解析 Building/BuildingPart 与必要 Building-local xlink；完整 LOD2 优先，否则整栋完整 LOD1，禁止混合；正式高度为所选 Geometry 的 `max(Z)-min(Z)`，`measuredHeight` 只作 QA；固定 `2026-09-23` JST 09:00/12:00/15:00，以 Meeus/NOAA 太阳几何并采用 NREL SPA 方位角约定投影建筑表面；Shadow union 后扣除全部 Building Footprint；Edge Score 为道路真实中心线与 Shadow 相交长度比例
- **质量统计：** 14 个 Raw GML；20,870 栋解析建筑；20,865 栋有效；LOD2 18,498 栋；LOD1 回退 2,367 栋；5 栋无完整 LOD；参与道路影响范围计算 12,723 栋；Geometry Height min/median/max 为 0.049/17.592/264.643m
- **浏览器数据：** Shade Schema `1.0.0`，严格对应 Graph Schema `1.1.0` 的 16,046 个 Edge ID；三个场景均具有非零差异；`shade.json` 不包含 Raw Geometry 或 Shadow Polygon
- **当前状态：** `ready`，M10 production validation 通过；M10.5 以独立 Sidecar Context 接入浏览器 Routing，不修改 Graph Schema
- **已知限制：** 仅覆盖当前 Demo Area；阴影为固定日期/时间的模型几何结果，不包含天气、树冠、地形、材质、辐射强度、实际人行道宽度或实时遮阴。异常低高度保留为 Geometry QA 事实，不以猜测值替换。

## 6. JMA Weather Data

- **发布机构：** 日本气象厅
- **官方来源：** <https://www.jma.go.jp/jma/index.html>
- **用途：** 已取消作为 Production Feature；仅保留为 Future Work 研究方向
- **获取方式：** M1 只登记官方入口，不假设具体 API
- **文件格式 / License：** 尚未核验
- **本地位置：** Raw `data/raw/weather/`；Processed `data/processed/environment/`
- **处理方法：** 尚未实施
- **当前状态：** `not_started`；不进入当前 Production Roadmap
- **已知限制：** 天气数据不得被描述为某条道路的真实气温。

## 数据获取失败时的统一行为

```text
官方数据源 -> 尝试获取 -> 失败时明确报告
                 -> 保留 Loader -> 要求人工提供官方文件
```

禁止生成假数据、将 `synthetic` 数据说成真实数据、悄悄切换到 Kaggle/第三方博客/无法验证的 GitHub 数据，或为了让程序成功而硬编码看似合理的数值。
