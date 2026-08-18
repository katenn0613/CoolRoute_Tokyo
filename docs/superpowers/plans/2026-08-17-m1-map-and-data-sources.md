# CoolRoute Tokyo M1 基础地图与数据源实施计划

> **供执行代理使用：** 必须使用子技能 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务执行本计划。步骤使用复选框（`- [ ]`）跟踪。

**目标：** 创建可构建的 React + Vite + MapLibre M1 前端，并建立不下载、不伪造数据的权威数据 Registry 与 Python Loader 框架。

**架构：** 前端使用集中配置驱动独立的地图、路线控件和数据状态组件。MapLibre 只显示底图，所有项目数据保持 `pending` 或 `not_started`；Python 仅提供可验证本地文件的离线接口。

**技术栈：** React 19.2.8、Vite 8.2.1、JavaScript、MapLibre GL JS 6.4.0、Vitest 4.1.10、React Testing Library 16.3.2、jsdom 30.0.1、Python 标准库 `unittest`。

**规格：** `docs/superpowers/specs/2026-08-17-m1-map-and-data-sources-design.md`

## 全局约束

- 保持 GitHub Pages 静态部署，`vite.config.js` 必须使用 `base: './'`。
- 不得引入线上后端、数据库、容器、LLM 或用户系统。
- 不得实现寻路、Heat Exposure Score、GIS Spatial Join、PLATEAU 阴影或天气模型。
- 不下载项目数据，不将合成数据写入 `public/data/`。
- 坐标只能来自 `src/config/demoArea.js`。
- 未核验的格式和许可证必须保持 `null` 或明确说明尚未核验。
- 单元测试不得请求地图瓦片或官方数据。

---

### 任务 1：前端工程与配置契约

**文件：**

- 创建：`package.json`
- 创建：`package-lock.json`
- 创建：`vite.config.js`
- 创建：`index.html`
- 创建：`src/config/demoArea.js`
- 创建：`src/config/dataSources.js`
- 创建：`src/config/mapStyle.js`
- 创建：`src/utils/assetPath.js`
- 创建：`tests/javascript/setup.js`
- 创建：`tests/javascript/config.test.js`

**接口：**

- 输出：`demoArea` 冻结对象，包含 `id`/`name`/`center`/`zoom`/`boundingBox`。
- 输出：`DATA_SOURCE_STATUS`、`dataSources` 和 `statusDataSources`。
- 输出：`mapStyle` MapLibre style v8 对象。
- 输出：`assetPath(relativePath)` 返回带 Vite base path 的静态资源 URL。

- [x] **步骤 1：创建工程文件与失败的配置测试。**

`package.json` 必须包含 `dev`/`build`/`preview`/`test` 命令和上述锁定主版本依赖。`config.test.js` 首先导入尚不存在的配置：

```js
import { describe, expect, it } from 'vitest'
import { demoArea } from '../../src/config/demoArea.js'
import { DATA_SOURCE_STATUS, dataSources } from '../../src/config/dataSources.js'

it('keeps the demo area in one valid 2–3 km configuration', () => {
  expect(demoArea.id).toBe('temporary_demo_area')
  expect(demoArea.center).toHaveLength(2)
  expect(demoArea.boundingBox[0]).toBeLessThan(demoArea.boundingBox[2])
  expect(demoArea.boundingBox[1]).toBeLessThan(demoArea.boundingBox[3])
})

it('defines six sources with only M1 statuses', () => {
  expect(dataSources).toHaveLength(6)
  expect(dataSources.every((source) => Object.values(DATA_SOURCE_STATUS).includes(source.status))).toBe(true)
})
```

- [x] **步骤 2：安装依赖并确认测试因配置模块缺失而失败。**

运行：`npm install && npm test -- --run tests/javascript/config.test.js`
预期：Vitest 报告无法解析 `src/config/demoArea.js`。

- [x] **步骤 3：实现集中配置与资源路径。**

`demoArea.js` 使用规格中的精确数值；`dataSources.js` 定义六条冻结记录；`mapStyle.js` 使用 `https://tile.openstreetmap.org/{z}/{x}/{y}.png` 和可见 attribution；`assetPath.js` 去除文件名开头的 `/` 后与 `import.meta.env.BASE_URL` 组合。

```js
export function assetPath(relativePath) {
  return `${import.meta.env.BASE_URL}${relativePath.replace(/^\/+/, '')}`
}
```

- [x] **步骤 4：确认配置测试通过。**

运行：`npm test -- --run tests/javascript/config.test.js`
预期：2 个测试通过。

### 任务 2：控制面板和数据状态 UI

**文件：**

- 创建：`src/App.jsx`
- 创建：`src/main.jsx`
- 创建：`src/components/RouteControls.jsx`
- 创建：`src/components/DataStatus.jsx`
- 创建：`src/styles.css`
- 创建：`tests/javascript/App.test.jsx`

**接口：**

- 输入：`demoArea.name` 和 `statusDataSources`。
- 输出：一个包含路线预览、三个数据状态和地图插槽的响应式页面。

- [x] **步骤 1：创建失败的 App 测试。**

```jsx
render(<App />)
expect(screen.getByRole('heading', { name: 'CoolRoute Tokyo' })).toBeInTheDocument()
expect(screen.getByLabelText('Fastest')).toBeInTheDocument()
expect(screen.getByLabelText('Balanced')).toBeInTheDocument()
expect(screen.getByLabelText('Coolest')).toBeInTheDocument()
expect(screen.getByRole('button', { name: /Find Route/i })).toBeDisabled()
expect(screen.getAllByText('Pending')).toHaveLength(3)
```

`MapView` 在本测试中 mock 为普通 `<div data-testid="map-view" />`。

- [x] **步骤 2：运行测试并确认因 `App.jsx` 缺失而失败。**

运行：`npm test -- --run tests/javascript/App.test.jsx`
预期：Vitest 报告无法解析 `src/App.jsx`。

- [x] **步骤 3：实现最小控制面板和响应式样式。**

`RouteControls` 的 Start/Destination 输入和 `Find Route` 按钮都禁用；三个 radio 共用 `route-mode` 名称。`DataStatus` 只映射 `statusDataSources`，将 `pending` 显示为 `Pending`。CSS 在 `900px` 以下切换为上下布局，地图最小高度为 `460px`。

- [x] **步骤 4：运行 App 测试并确认通过。**

运行：`npm test -- --run tests/javascript/App.test.jsx`
预期：所有 UI 断言通过。

### 任务 3：MapLibre 地图生命周期

**文件：**

- 创建：`src/components/MapView.jsx`
- 创建：`tests/javascript/MapView.test.jsx`

**接口：**

- 输入：`demoArea`、`mapStyle` 和 MapLibre v6 worker URL。
- 输出：`MapView` 组件，提供 `loading`/`ready`/`error` 显示状态并在卸载时清理 Map 实例。

- [x] **步骤 1：使用 hoisted MapLibre mock 创建失败的生命周期测试。**

```jsx
expect(mapConstructor).toHaveBeenCalledWith(expect.objectContaining({
  center: demoArea.center,
  zoom: demoArea.zoom,
  maxBounds: demoArea.boundingBox,
}))
act(() => handlers.load())
expect(screen.getByText('地图已就绪')).toBeInTheDocument()
unmount()
expect(remove).toHaveBeenCalledOnce()
```

- [x] **步骤 2：运行测试并确认因 `MapView.jsx` 缺失而失败。**

运行：`npm test -- --run tests/javascript/MapView.test.jsx`

- [x] **步骤 3：实现 MapLibre 实例、worker、导航控件、状态与清理。**

```js
setWorkerUrl(workerUrl)
const map = new Map({
  container: containerRef.current,
  style: mapStyle,
  center: demoArea.center,
  zoom: demoArea.zoom,
  maxBounds: demoArea.boundingBox,
  attributionControl: true,
})
map.addControl(new NavigationControl(), 'top-right')
```

`error` 在地图尚未 `ready` 时将 UI 切换为“地图暂时无法加载”；不向用户显示原始异常。

- [x] **步骤 4：运行地图测试和全部 JavaScript 测试。**

运行：`npm test -- --run`
预期：配置、App 和 MapView 测试全部通过。

### 任务 4：非下载型 Python Loader 与数据目录

**文件：**

- 创建：`scripts/data_sources/__init__.py`
- 创建：`scripts/data_sources/source_utils.py`
- 创建：`scripts/data_sources/osm_source.py`
- 创建：`scripts/data_sources/green_source.py`
- 创建：`scripts/data_sources/drinking_station_source.py`
- 创建：`tests/python/test_data_sources.py`
- 创建：`data/raw/{osm,green,drinking_station,trees,plateau,weather}/.gitkeep`
- 创建：`data/processed/{osm,green,drinking_station,environment}/.gitkeep`

**接口：**

- `SourceStatus(str, Enum)` 值为 `PENDING`/`NOT_STARTED`。
- `SourceMetadata` 包含 `source_name`/`provider`/`source_page`/`raw_directory`/`processed_directory`/`status`/`required`。
- `RawDataValidation` 包含 `available`/`matched_files`/`message`。
- `BaseDataSource.download()` 抛出 `SourceNotAvailableError`。
- `BaseDataSource.validate_raw_data()` 只匹配配置的后缀。

- [x] **步骤 1：创建失败的 Python 接口测试。**

```python
with self.assertRaises(SourceNotAvailableError):
    source.download()
self.assertEqual(before, set(self.raw_directory.iterdir()))
self.assertFalse(source.validate_raw_data().available)
```

测试必须使用 `tempfile.TemporaryDirectory()`，不得写入项目 Raw 目录。

- [x] **步骤 2：运行测试并确认因 `scripts.data_sources` 导入失败。**

运行：`python3 -m unittest discover -s tests/python -v`

- [x] **步骤 3：实现基类、三个数据源和指定目录。**

```python
def download(self) -> NoReturn:
    raise SourceNotAvailableError(
        f"{self.metadata.source_name} 仍为 {self.metadata.status.value}。"
        f" 请从官方页面获取数据：{self.metadata.source_page}"
    )
```

`validate_raw_data()` 使用 `Path.iterdir()` 和小写后缀集合检测文件，不读取、解析或修改内容。

- [x] **步骤 4：运行 Python 测试并确认通过。**

运行：`python3 -m unittest discover -s tests/python -v`

### 任务 5：数据文档、项目说明与端到端验收

**文件：**

- 创建：`docs/DATA_SOURCES.md`
- 修改：`README.md`
- 修改：`docs/superpowers/plans/2026-08-17-m1-map-and-data-sources.md`

**接口：**

- 输出：六个数据源的官方来源、获取方式、路径、处理计划、状态和限制。
- 输出：与实际 M1 运行命令和目录一致的 README。

- [x] **步骤 1：编写 `DATA_SOURCES.md`，对未核验信息使用“尚未核验”，不填充猜测值。**
- [x] **步骤 2：更新 README 的 M1 状态、命令、Demo 区域和数据 Pending 说明。**
- [x] **步骤 3：执行全部自动化验证。**

```bash
npm test -- --run
npm run build
python3 -m unittest discover -s tests/python -v
```

- [x] **步骤 4：从 `dist/` 启动静态预览，在真实浏览器中检查地图、布局、数据状态和控制台。**

> 当前环境未提供可用浏览器实例；自动化阶段完成了 `dist/` 静态预览及模拟 GitHub Pages 子路径的 HTTP 资源验证，随后由项目使用者确认真实浏览器验收无问题。

运行：`npm run preview -- --host 127.0.0.1`
预期：页面显示东京站/皇居东侧地图、3 个 Pending 数据状态和禁用的 Find Route；浏览器控制台无应用运行时错误。

- [x] **步骤 5：扫描架构边界，确认没有后端、数据库、寻路、Heat Exposure Score 实现或伪造数据。**

运行：使用 `find` 列出文件，并使用 `grep` 检查禁止依赖与功能标识；文档中的禁止性说明不计为实现。
