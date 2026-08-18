# CoolRoute Tokyo M5 Heat Exposure Model 与三模式路由设计规格

## 1. 目标与边界

M5 在浏览器端使用 M4 Browser Graph Schema 1.1.0 的 `green_score` 和 `water_penalty`，实现统一的 Heat Exposure Model、一个可注入权重的 Dijkstra，以及 Fastest、Balanced、Coolest 三种路线。正式应用继续部署到 GitHub Pages，不使用后端、远程 Routing API、数据库或服务器运行环境。

M5 只进行基础三路线显示，不进入 M6 UI 重构。`Coolest` 的准确方法学含义是“对低模型热暴露赋予更高权重的距离—暴露折中路线”，不是无条件全局最低 Heat Exposure 路线。

## 2. 术语与禁止表述

允许使用：Heat Exposure Score、Heat Exposure Index、Modelled Heat Exposure、热暴露评分、模型热暴露指标、Modelled Exposure Load。

禁止描述为 Heatstroke Probability、中暑概率、医疗风险概率、医学风险下降、医学剂量或安全保证。所有结果都是基于当前模型和数据覆盖的路线比较代理值。

## 3. 统一配置

`src/config/routingConfig.js` 是唯一参数源：

```text
walkingSpeedMetersPerSecond = 1.4
maximumSnapDistanceMeters = 200
greenWeight = 0.7
waterWeight = 0.3
balancedLambda = 1
coolestLambda = 3
maximumExtraDistanceRatio = null
```

`maximumExtraDistanceRatio = 0.25` 的唯一含义是“候选路线最多比 Fastest 多走 25%”。`null` 表示完全关闭，M5 不启用任何绕行阈值。

## 4. Edge Exposure 与路由成本

每条 Edge 的模型环境热暴露强度：

```text
edgeHeatExposure =
  0.7 × (1 - green_score)
  + 0.3 × water_penalty
```

输入必须是 `[0,1]` 内有限数；缺失、NaN、Inf 或越界立即报错。输出必须位于 `[0,1]`。

三种 Edge Cost：

```text
Fastest:  length
Balanced: length × (1 + 1 × edgeHeatExposure)
Coolest:  length × (1 + 3 × edgeHeatExposure)
```

路线总成本数学上等价于：

```text
totalDistance + lambda × modelledExposureLoad
```

所以 Balanced/Coolest 权衡 Walking Distance 与 Cumulative Modelled Exposure Load，并非直接最小化平均 Heat Exposure Score。

## 5. 单一 Weighted Dijkstra

`weightedDijkstra(graph, startId, destinationId, weightFunction)` 是唯一寻路实现。Weight Function 必须返回有限、非负成本。算法保留具体有向 MultiEdge、predecessor Edge、Node Sequence、Edge Sequence，并返回 `totalCost` 与实际 `totalDistance`。

`findShortestPath()` 保留为以 `edge.length` 加权的兼容包装。Fastest、Balanced、Coolest 不得复制 Dijkstra。

## 6. Route Metrics

### 6.1 平均模型环境强度

```text
averageHeatExposure =
  Σ(edge.length × edgeHeatExposure) / Σ(edge.length)
```

范围 `[0,1]`，前端标签为 Heat Exposure Score。它表示单位距离上的平均模型环境热暴露强度，用于描述路线环境质量。

### 6.2 累计模型暴露代理量

```text
modelledExposureLoad = Σ(edge.length × edgeHeatExposure)
```

它同时考虑路线长度与 Edge Exposure，不赋予物理或医疗单位，不得命名为 dose、medical exposure 或 health risk。

### 6.3 Green / Water

```text
greenIndicator = Σ(length × green_score) / Σ(length)
waterAccessIndicator = 1 - Σ(length × water_penalty) / Σ(length)
```

二者范围 `[0,1]`。Water Access Indicator 是路线 Edge 对 Drinking Station proximity 的长度加权平均指标，不表示站点数量，也不保证路线实际经过站点。

## 7. 路线比较

Balanced 和 Coolest 都相对 Fastest 计算：

- `extraDistanceMeters`
- `extraDistancePercent`
- `extraWalkingMinutes`
- `averageHeatExposureChange`
- `averageHeatExposureReduction`
- `averageHeatExposureReductionPercent`
- `modelledExposureLoadChange`
- `modelledExposureLoadReduction`
- `modelledExposureLoadReductionPercent`

Reduction 使用 `baseline - candidate`；正值表示降低，负值表示增加。Fastest 基准为 0 时对应百分比返回 `null`。UI 若写 “Modelled Heat Exposure ↓ X%”，只能使用 `modelledExposureLoadReductionPercent`；平均值变化必须写 “Average Heat Exposure Score”。

## 8. Detour Guard

独立函数以候选路线距离和 Fastest 距离验证 `maximumExtraDistanceRatio`。默认 `null` 直接放行；非空时，允许上限为：

```text
candidateDistance <= fastestDistance × (1 + maximumExtraDistanceRatio)
```

M5 只建立验证机制，不实现约束最短路径搜索，不擅自启用阈值。

## 9. 交互与 UI

第二个有效点提交前，一次计算三条路线；任一必要计算失败则保留旧起终点和旧路线。状态中保存 `routes.fastest/balanced/coolest` 与 `selectedMode`。Radio 三种模式全部开放；切换模式不重新寻路，只切换地图 GeoJSON 和指标。地图一次只显示选中路线。

控制面板以紧凑方式显示三条路线的 Distance、Walking Time、Heat Exposure Score；详情/比较显示 Modelled Exposure Load change。保留 Find Route、事务式重新选择和 Reset，不进行 M6 布局重构。

## 10. 真实东京案例

用固定 random seed 从正式图选择 Node Pair，不穷举全部组合。候选过滤过近点、不可达点以及不合理直线/路线距离。保存至少 5 组可复现案例的 Start Node ID、Destination Node ID 和三种路线结果：至少 1 组 Fastest 与 Coolest Edge Sequence 相同，至少 2–3 组自然 Trade-off。不得修改正式 Edge Score。

## 11. 验收

- Fastest 等价 distance-only；lambda 0 等价 Fastest。
- 高 Exposure Edge 在高 lambda 下可被避开。
- Average Heat Exposure 和 Modelled Exposure Load 分别正确。
- 能正确表达“平均值降低但累计 Load 增加”。
- 路由成本等于 `distance + lambda × exposureLoad`。
- 所有 Score/Indicator 范围正确，所有 Cost 非负有限。
- 缺失或无效环境字段明确失败，不允许 NaN 扩散。
- 百分比除零返回 `null`。
- M3 事务式交互、真实 geometry、MultiEdge 和 Fastest 基线继续通过。
- `npm test -- --run` 与 `npm run build` 成功。

M5 完成后停止，不进入 M6。
