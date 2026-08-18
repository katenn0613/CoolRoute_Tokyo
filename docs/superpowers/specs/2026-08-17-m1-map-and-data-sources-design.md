# CoolRoute Tokyo M1 基础地图与数据源设计

**里程碑：** M1：基础地图前端与数据源接入准备
**状态：** 2026-08-17 已完成书面规格审阅，批准执行
**依赖：** `AGENTS.md`、`PROJECT_SPEC.md`、`README.md`

## 1. 范围

M1 将创建一个可运行的 React + Vite + JavaScript 应用和 MapLibre 地图，并为后续真实数据工作建立权威 Registry 与 Loader 接口。

M1 不下载项目数据集，也不实现 Dijkstra、Fastest Route、Balanced Route、Coolest Route、Heat Exposure Score 计算、GIS Spatial Join、PLATEAU 阴影模型或天气模型。路线控件只是不可用的界面预览，不得暗示寻路功能已存在。

正式架构仍为静态 GitHub Pages 应用。Node.js 只是开发/构建工具，不是正式服务器。Python 模块只是离线 Loader 框架。

## 2. 设计决策

### 2.1 轻量模块化前端

前端使用少量、职责单一的 React 组件：

- `App.jsx` 只负责组合页面。
- `RouteControls.jsx` 渲染只读起点/终点预览字段、三种路线模式和禁用的寻路操作。
- `DataStatus.jsx` 读取 Registry 并渲染三个 M1 数据源状态。
- `MapView.jsx` 拥有 MapLibre 实例、生命周期、加载状态和错误状态。
- `demoArea.js`、`dataSources.js` 和 `mapStyle.js` 分别是地理范围、数据集和底图配置的唯一事实来源。
- `assetPath.js` 通过 `import.meta.env.BASE_URL` 解析未来的公共静态资源。

这一方案优于将所有内容写入 `App.jsx`，因为后者会将配置和渲染耦合；也优于现在就引入路由器或全局状态库，因为 M1 并不需要这些。

### 2.2 Demo 区域

M1 使用一个可替换的开发区域，覆盖皇居东侧、丸之内和东京站周边：

```js
{
  id: 'temporary_demo_area',
  name: 'Imperial Palace East – Marunouchi – Tokyo Station',
  center: [139.7575, 35.6830],
  zoom: 14.2,
  boundingBox: [139.7440, 35.6720, 139.7710, 35.6940],
}
```

该边界框东西约 2.4 km、南北约 2.4 km，同时包含较大绿地和密集街路网，适合后续比较。它必须明确标记为临时区域；切换研究区域时只应修改该配置文件，不应编辑组件。

### 2.3 开发底图

`mapStyle.js` 定义一个 MapLibre 样式对象，使用 OpenStreetMap 标准栅格瓦片端点，并显示 OpenStreetMap attribution。M1 只进行正常交互式瓦片加载：不预取、抓取、代理或离线下载瓦片。

底图和未来的 OSM 步行图是两个独立的就绪状态。底图可见并不代表 `osm-walking-network` 数据集已就绪。在 M2 生成图资源前，Data Status UI 必须显示 `OpenStreetMap Walking Network — Pending`。

瓦片使用政策记录在 `docs/DATA_SOURCES.md`：<https://operations.osmfoundation.org/policies/tiles/>。

## 3. 前端结构与行为

```text
index.html
package.json
vite.config.js
src/
├── App.jsx
├── main.jsx
├── styles.css
├── components/
│   ├── DataStatus.jsx
│   ├── MapView.jsx
│   └── RouteControls.jsx
├── config/
│   ├── dataSources.js
│   ├── demoArea.js
│   └── mapStyle.js
└── utils/
    └── assetPath.js
```

### 3.1 布局

- 桌面端：左侧为固定宽度控制面板，右侧为自适应地图。
- 窄屏：控件堆叠在地图上方。
- 页面标题显示 `CoolRoute Tokyo` 并标识 M1 Demo 区域。
- Start 和 Destination 是禁用的预览字段。
- Fastest、Balanced 和 Coolest 单选项保留，以维持界面连续性。
- `Find Route` 按钮禁用，并标明 M1 不可用。
- Data Status 从 Registry 读取 OpenStreetMap Walking Network、Tokyo Green GIS 和 Tokyowater Drinking Station，并显示 `Pending`。

### 3.2 地图生命周期

`MapView` 执行以下操作：

1. 容器挂载后创建唯一 MapLibre `Map` 实例；
2. 使用 `demoArea.center`、`demoArea.zoom` 和 `demoArea.boundingBox`；
3. 导入 MapLibre CSS，并通过 `?worker&url` 配置 v6 Vite worker；
4. 添加导航控件；
5. 在地图触发 `load` 前显示加载层；
6. 如果地图在就绪前触发 `error`，显示直接易懂的错误信息；
7. React 清理时调用 `map.remove()`。

M1 不添加路线图层、点选择、地理编码器或路网获取。

## 4. GitHub Pages 兼容性

- `vite.config.js` 使用 `base: './'`，不假设站点从 `/` 提供。
- 导入的 JavaScript、CSS 和 worker 资源由 Vite 生成相对 URL。
- 未来 `public/data/` 中的文件通过 `assetPath()` 引用，该函数将文件名与 `import.meta.env.BASE_URL` 组合。
- 运行时 URL 不得使用硬编码的项目根路径 `/data/...`。
- M1 不添加部署工作流，也不部署站点。

Vite base path 行为见 <https://vite.dev/config/shared-options.html#base>。

## 5. 权威数据 Registry

`src/config/dataSources.js` 导出不可变记录，每条记录包含：

```text
id
name
provider
sourcePage
purpose
status
localRawPath
processedPath
required
priority
browserPath（已指定未来浏览器资源时）
format
license
notes
showInStatus
```

M1 允许的状态值为 `pending` 和 `not_started`。`ready` 保留给后续已完成真实资源下载、验证、处理和记录的里程碑。

Registry 包含：

1. `osm-walking-network`：必需，P0，`pending`。
2. `tokyo-green-gis`：必需，P0，`pending`；在比较候选数据前，不声称具体数据集、格式或许可证。
3. `tokyowater-drinking-stations`：可选路线背景，P1，`pending`；记录官方数据集页面和 CC BY 许可证。
4. `tokyo-street-trees`：可选，P2，`not_started`。
5. `plateau-3d-buildings`：可选，P2，`not_started`。
6. `jma-weather`：可选，P2，`not_started`。

`docs/DATA_SOURCES.md` 是面向开发者的对应文档，记录发布机构、官方页面、预期用途、获取方式、已知格式、已验证许可证、Raw/Processed/Browser 路径、处理概要、当前状态和限制。未知字段必须明确说明尚未验证，不得猜测。

## 6. 离线 Python 数据源框架

```text
scripts/data_sources/
├── __init__.py
├── source_utils.py
├── osm_source.py
├── green_source.py
└── drinking_station_source.py
```

`source_utils.py` 定义：

- 冻结的 `SourceMetadata` dataclass；
- `SourceStatus` 字符串枚举；
- `RawDataValidation` 结果 dataclass；
- `SourceNotAvailableError` 异常；
- 带有 `download()` 和 `validate_raw_data()` 的 `BaseDataSource` 接口。

每个具体数据源都暴露 M1 所需元数据。`download()` 必须故意抛出 `SourceNotAvailableError`，并给出官方页面和下一个人工/实现步骤。该方法不得发起网络请求、创建假数据或悄悄切换发布机构。`validate_raw_data()` 只检查预期本地文件类型，并返回明确的缺失/存在结果；不执行 GIS 处理。

原始数据目录：

```text
data/raw/osm/
data/raw/green/
data/raw/drinking_station/
data/raw/trees/
data/raw/plateau/
data/raw/weather/
```

处理后目录：

```text
data/processed/osm/
data/processed/green/
data/processed/drinking_station/
data/processed/environment/
```

原始文件是不可变输入。M1 任何命令都不得在这些目录中写入真实或合成数据集。

## 7. 已核验数据源事实与不确定性

- OpenStreetMap 数据使用 ODbL，并要求 attribution：<https://www.openstreetmap.org/copyright>。
- OSMnx 支持在经纬度边界框内下载 `walk` 网络：<https://osmnx.readthedocs.io/en/latest/>。
- Tokyowater Drinking Station 由东京都水道局发布，官方目录列出 CSV 资源和 CC BY 许可证：<https://catalog.data.metro.tokyo.lg.jp/dataset/t000019d0000000003>。
- Tokyo Green GIS 记录指向东京都开放数据目录。在比较发布机构、覆盖范围、格式、更新日期、许可证和 Demo 区域覆盖前，不选定具体多边形数据集。
- 街路树只登记东京都官方目录，保持 P2。M1 不得将表格统计数量当作地理树木点。
- Project PLATEAU 使用国土交通省官方入口：<https://www.mlit.go.jp/plateau/>。
- JMA 天气使用日本气象厅官方入口：<https://www.jma.go.jp/jma/index.html>。M1 不声称存在某个特定 API 或街道级气温产品。

## 8. 数据真实性失败行为

官方数据无法获取时：

```text
官方数据源 -> 尝试获取 -> 明确报告失败
                 -> 保留 Loader -> 请求人工提供官方文件
```

实现不得生成看似合理的数据、更换合成数据标签、替换为 Kaggle 或无法验证的 GitHub 仓库、抓取 Google Maps，或硬编码数值让 Demo 显得已完成。合成数据只能存在于命名清楚的单元/开发测试中，不得作为 Demo Data 进入 `public/data/`。

以上规则将以简洁但具有约束力的形式加入 `AGENTS.md`。

## 9. 测试与验证

### 9.1 JavaScript 测试

使用 Vitest、jsdom 和 React Testing Library 验证：

- Demo Area 记录包含有效 center 和顺序正确的 bounding box；
- 所有 Registry 记录包含必需字段和有效 M1 状态；
- 应用渲染三种路线模式和三个 Pending 数据状态；
- 寻路操作已禁用；
- `MapView` 使用集中配置创建 MapLibre，并在卸载时移除实例。

单元测试中必须 mock MapLibre，不得下载瓦片。

### 9.2 Python 测试

使用标准库 `unittest` 验证：

- 每个数据源都暴露有效元数据；
- `download()` 抛出明确的不可用错误且不写入文件；
- 对空临时目录的验证返回缺失状态；
- 能检测后缀正确的本地 fixture，但不解析或修改它。

### 9.3 端到端检查

运行：

```text
npm install
npm test
npm run build
python3 -m unittest discover -s tests/python -v
```

然后在本地托管构建后的 `dist/` 目录，并在真实浏览器中检查。验证东京地图正常渲染、MapLibre 进入就绪状态、控件和数据状态可见、控制台无错误，以及从嵌套预览路径打开时相对资源 URL 仍然有效。

## 10. M1 退出条件

只有同时满足以下条件，M1 才算完成：

- React 可运行且正式构建成功；
- MapLibre 在真实浏览器中渲染已配置的东京区域；
- 前端数据状态从 Registry 读取；
- 六个数据源及其限制都已记录；
- Python Loader 仍然是不执行下载且行为明确的框架；
- 必需 Raw/Processed 目录存在；
- 测试通过；
- 没有引入后端、数据库、伪造数据、GIS Spatial Join、Heat Exposure Score 逻辑或寻路算法；
- 完成后停止，不进入 M2。
