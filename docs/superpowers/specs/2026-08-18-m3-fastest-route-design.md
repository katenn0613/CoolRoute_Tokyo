# CoolRoute Tokyo M3 浏览器端 Fastest Route 设计

**状态：** 已批准，包含 2026-08-18 交互规则确认。

## 1. 目标与范围

M3 使用 M2 生成的真实 `public/data/graph.json`，在浏览器内完成：

```text
地图点击 -> Demo Area 校验 -> Nearest Node -> Dijkstra(edge.length)
        -> Edge geometry 拼接 -> MapLibre 路线 -> 距离/时间/Edge 数
```

M3 只开放 Fastest Route。Balanced 和 Coolest 继续显示但禁用，不实现 Heat Exposure Score、环境权重、Green、Drinking Station、Weather 或 PLATEAU，也不调用任何远程 Routing API。

## 2. 模块边界

- `src/routing/graphLoader.js`：通过 `assetPath('data/graph.json')` 获取 Graph Schema 1.0.0，验证顶层结构、数量、Node、Edge、geometry 和引用，并构建浏览器内索引；不硬编码 localhost。
- `src/routing/nearestNode.js`：先严格检查点击点是否位于 Demo Area，再线性扫描最近 Node。当前 5,350 个 Node 足够小，不引入 KD-tree。
- `src/routing/dijkstra.js`：使用最小堆和 `edge.length` 计算有向最短路，predecessor 同时记录前驱 Node 和具体 Edge ID，因此平行 MultiEdge 不会互相覆盖。
- `src/routing/routeGeometry.js`：按 Edge Sequence 拼接原始道路 geometry，只去除相邻 Edge 接缝处的重复坐标；不以 Node 折线替代道路形状。
- `src/routing/routeMetrics.js`：从 Edge Sequence 计算 Distance、Estimated Walking Time 和 Edge Count。
- `src/routing/selectionMachine.js`：唯一的交互状态机和事务式候选提交规则。
- `src/routing/useFastestRoute.js`：持有 Graph ref、异步加载、吸附、Dijkstra、性能计时和状态机 dispatch；React 组件不保存完整 Graph。
- `src/components/MapView.jsx`：只负责 MapLibre map、点击转发、Marker 和 GeoJSON route source/layer。
- `src/components/RouteControls.jsx`：只展示状态、指标和显式操作按钮。

## 3. Graph Loader 契约

Loader 接受依赖注入的 `fetchImpl`，默认使用 `globalThis.fetch`。请求 URL 必须由 `assetPath('data/graph.json')` 产生，以兼容 GitHub Pages 根路径和仓库子路径。

只接受：

- `metadata.graphVersion === '1.0.0'`；
- `metadata.nodeCount`、`metadata.edgeCount` 与内容一致；
- Node ID、合法经纬度；
- 唯一 Edge ID、已存在的 source/target、正数 length；
- 至少两个合法 `[lon, lat]` geometry 坐标。

准备后的 Graph 为：

```js
{
  metadata,
  nodes: Map<string, Node>,
  edges: Map<string, Edge>,
  adjacency: Map<string, Edge[]>
}
```

加载状态为 `loading | ready | error`，失败时 UI 显示可理解的错误，不显示原始堆栈。

## 4. Nearest Node 与选择边界

点击坐标必须先通过 `demoArea.boundingBox` 的严格检查。超出边界直接失败，不吸附到图边缘。

边界内使用等距近似的经纬度距离线性扫描全部 Node，并返回 Node 与实际吸附距离。`src/config/routingConfig.js` 统一设置：

```js
walkingSpeedMetersPerSecond: 1.4
maximumSnapDistanceMeters: 200
```

最近 Node 超过 200 m 时视为无效选择，以免把道路覆盖稀疏处吸附到明显遥远的道路。Start / Destination Marker 显示吸附后的真实 Node 坐标，而不是未经吸附的点击坐标。

## 5. Dijkstra 与 MultiEdge

Fastest Route 的 M3 cost 为：

```text
cost(edge) = edge.length
```

Dijkstra 输入 prepared Graph、start Node ID 和 destination Node ID；输出：

```js
{
  found: true,
  totalDistance,
  nodeSequence,
  edgeSequence
}
```

不可达时返回 `found: false` 和空序列。`start === destination` 返回 found、距离 0、单 Node 和空 Edge。每条 adjacency Edge 独立松弛；predecessor 保存 `{nodeId, edgeId}`，确保选中的平行边可准确还原。

## 6. Geometry 与指标

每条 Edge 的 geometry 已在 M2 中按 `source -> target` 定向。拼接时验证前一 Edge target 等于后一 Edge source，并验证 geometry 接缝连续；接缝相同坐标只保留一次。非空路线输出 GeoJSON Feature/LineString。

指标统一为：

- `distanceMeters = sum(edge.length)`；
- `walkingTimeSeconds = distanceMeters / 1.4`；
- `edgeCount = edgeSequence.length`。

步行时间是基于统一速度假设的估计，不是实时导航 ETA。

## 7. 交互状态机

状态只能是：

- `awaiting-start`
- `awaiting-destination`
- `route-ready`
- `selecting-start`
- `selecting-destination`

初始第一次有效点击提交 Start，第二次有效点击提交 Destination 并自动计算。路线完成后普通地图点击被忽略。

“重新选择起点/终点”进入对应 selecting 状态。新点击先完成边界检查、吸附和与保留端点之间的 Dijkstra；只有全部成功才一次性提交新端点和 Route，然后返回 `route-ready`。失败时旧 Start、Destination 和 Route 保持不变，并停留在 selecting 状态供用户重试。

Reset 清除两点、路线、错误和 selection mode，回到 `awaiting-start`。Find Route 始终保留；拥有两个有效端点时可手动重算。

## 8. MapLibre 展示

MapView 在 map load 后注册：

- Start Marker；
- Destination Marker；
- `fastest-route` GeoJSON source；
- `fastest-route-line` line layer。

路线 source 使用完整拼接 geometry。组件卸载时删除 Marker 并调用 `map.remove()`。Graph 失败不阻止底图显示，但禁止选点并给出错误状态。

## 9. 测试与验收

Synthetic Graph 只存在于 `tests/javascript/fixtures/`：

- Graph loader schema 与 GitHub Pages path；
- 最近 Node、越界和最大吸附距离；
- 最短路径、disconnected、start=destination、MultiEdge 和总距离；
- geometry 拼接连续性和指标；
- 状态机合法转换、路线完成后忽略普通点击、事务式重选失败保留旧结果；
- MapLibre Marker/source/layer 生命周期。

另用 production `public/data/graph.json` 验证至少三组东京起终点。自动检查路线存在、距离合理、Edge geometry 连续、输出 geometry 与选中 Edge 完全一致；是否“明显穿墙/穿建筑”只能通过真实地图视觉检查，因为 M3 没有建筑 polygon 数据，不能虚构自动建筑相交验证。

最终执行 `npm test -- --run`、`npm run build`、真实路线性能脚本和浏览器交互检查。记录 Graph 加载/准备时间与三条路线的 Dijkstra 时间。
