# CoolRoute Tokyo 方法说明

## M5 模型范围

CoolRoute Tokyo 使用道路 Edge 上的官方数据派生代理值比较步行路线。结果是 Modelled Heat Exposure / 模型热暴露指标，不是 Heatstroke Probability、中暑概率、医疗风险概率、医学剂量或安全保证。

## Edge Heat Exposure

```text
edgeHeatExposure =
  0.7 × (1 - green_score)
  + 0.3 × water_penalty
```

`green_score` 是道路 15m Buffer 内官方实际绿色覆盖 Polygon 的覆盖比例代理值；`water_penalty` 由 Edge Geometry 到最近官方 Drinking Station Point 的距离映射。二者及 Edge Exposure 均在 `[0,1]`。

该模型没有直接使用气温、湿度、太阳辐射、树冠实时阴影、个人生理条件或医学观测，因此只适合在当前 Demo 数据覆盖内做相对路线比较。

## Average Heat Exposure 与 Modelled Exposure Load

Heat Exposure Score：

```text
averageHeatExposure =
  Σ(edge.length × edgeHeatExposure) / Σ(edge.length)
```

它表示路线单位距离上的平均模型环境热暴露强度，范围 `[0,1]`，用于描述路线环境质量。

Modelled Exposure Load：

```text
modelledExposureLoad = Σ(edge.length × edgeHeatExposure)
```

它是同时考虑路线长度后的累计模型暴露代理量，没有物理或医疗单位。较低的 Average Heat Exposure 不保证较低的 Modelled Exposure Load：路线绕行较长时，平均强度可以下降而累计 Load 上升。

## 三种路线成本

```text
Fastest  = Σ length
Balanced = Σ [length × (1 + 1 × edgeHeatExposure)]
Coolest  = Σ [length × (1 + 3 × edgeHeatExposure)]
```

Balanced/Coolest 的总成本等价于：

```text
totalDistance + lambda × modelledExposureLoad
```

因此算法权衡 Walking Distance 与 Cumulative Modelled Exposure Load。`Coolest` 是对低模型热暴露赋予更高权重的距离—暴露折中路线，不是无条件全局最低 Heat Exposure 路线。

三种模式共用同一个 `weightedDijkstra`，只替换 Weight Function。Fastest 仍严格使用 `edge.length`。

## Green 与 Water Indicator

```text
greenIndicator = Σ(length × green_score) / Σ(length)
waterAccessIndicator = 1 - Σ(length × water_penalty) / Σ(length)
```

Water Access Indicator 表示路线沿途各 Edge 对 Drinking Station proximity 的长度加权平均指标。它不表示路线附近有多少个 Drinking Station，也不表示用户一定经过某个站点。实际站点数量必须以后按 Route Geometry 与独立 Buffer 计算。

## 路线比较

所有比较以 Fastest 为基准。平均环境强度与累计 Load 分别计算变化和 reduction。Reduction 为 `Fastest - Candidate`；正值表示降低，负值表示增加。基准值为 0 时百分比为 `null`，不进行除零。

界面中的 “Modelled Heat Exposure reduction” 只能指 `modelledExposureLoadReductionPercent`。平均值下降必须明确写成 “Average Heat Exposure Score reduction”。

## M6 界面术语

正式日语 UI 将 `averageHeatExposure` 显示为 **平均暑さ曝露スコア**，将 `modelledExposureLoad` 显示为 **モデル上の累積暑さ曝露**。二者必须分开呈现；Trade-off 主句中的降低百分比只使用累计代理量的 `modelledExposureLoadReductionPercent`。无法计算的百分比显示 `比較不可`，不得用 0% 掩盖数据缺失或零基准。

地图上的 Heat Exposure Layer 仅将同一 `edgeHeatExposure` 计算结果映射为颜色，不定义新的权重或公式。因此路线成本、路线指标与地图颜色共享同一个模型来源。

## Detour Guard

统一配置名为 `maximumExtraDistanceRatio`：`0.25` 表示候选路线最多比 Fastest 多走 25%。M5 默认值为 `null`，即完全关闭，没有强制 25% 或其他阈值。

## 数据与模型限制

- Demo 只覆盖皇居东侧—丸之内—东京站约 2–3km 区域。
- Green 只使用官方定义明确的实际绿色覆盖 Polygon 白名单，不等于完整植被或实际遮阴。
- Drinking Station proximity 不代表开放时间、可达性或路线实际经过。
- 当前 weights 和 lambda 是可配置的 Demo 初始参数，尚未经过人体健康或行为研究验证。
- OSM 道路可通行性与官方环境数据都可能随时间变化。
- 实际环境、天气和个人反应可能与模型估计不同。
