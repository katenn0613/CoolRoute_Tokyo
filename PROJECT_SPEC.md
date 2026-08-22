# CoolRoute Tokyo 项目规格

## 1. 项目目标

CoolRoute Tokyo 是一款面向东京高温环境的浏览器端步行路线推荐 Demo。它帮助用户比较更快的步行路线与需要少量绕行、但模型估计热暴露更低的替代路线。

应用展示三种路线意图：

1. **Fastest Route**：最小化预计步行时间。
2. **Balanced Route**：以 lambda 1 权衡 Walking Distance 与累计 Modelled Exposure Load。
3. **Coolest Route**：以 lambda 3 对低模型热暴露赋予更高权重的距离—暴露折中路线；它不是无条件全局最低 Heat Exposure 路线。

M5 的 `maximumExtraDistanceRatio` 默认为 `null`，因此当前没有启用强制绕行上限。

原始黑客松 Demo 的 2–3 km 数据继续用于回归；当前正式 Production 默认覆盖东京23区，并通过 Binary Graph、Web Worker 与静态 MVT 在 GitHub Pages 中运行。Start / Destination 当前限制在 Tokyo23 Runtime Bounding Box 内。

Tokyo23 图包含 20 个弱连通组件，跨组件路线必须明确返回不可达；Binary Runtime 初始化失败时自动回退经过验证的 Core5 JSON Runtime。仓库保留最终 Binary/MVT 及机器可读 Metadata，但不保留约 288MB 的构建源 JSON。

## 2. 系统架构

### 2.1 正式运行环境

正式产物是一个完全托管在 **GitHub Pages** 上的静态 **React + Vite + JavaScript** 站点。**MapLibre GL JS** 负责渲染地图。应用从已部署站点获取静态预处理道路网和环境文件，并在浏览器端 JavaScript 中执行路线计算。

正式运行时不存在项目 API、后端服务器、服务器端 Python 进程、数据库、PostGIS、容器或 Node Server。

### 2.2 离线构建期预处理

开发或构建阶段的 Python 脚本可以：

- 获取步行道路网并裁剪到已批准的 Demo 边界；
- 验证和归一化真实环境开放数据；
- 将可用环境属性空间连接到道路段；
- 计算或准备边级模型输入；
- 使用 Project PLATEAU Geometry 离线预计算固定秋分日 09:00、12:00、15:00 的 Building Shade Sidecar；
- 导出紧凑的浏览器可读静态资源和来源元数据。

允许的 GIS 工具包括 GeoPandas、Shapely、OSMnx、NetworkX、Pandas 和 PyArrow。Python 不属于部署后的运行环境。

### 2.3 前端逻辑边界

- `src/components/`：展示和交互组件。
- `src/routing/`：浏览器端图加载、代价模型和路线算法。
- `src/utils/`：不承担产品 UI 职责的小型共享工具。
- `public/data/`：供浏览器消费的版本化静态资源。
- `scripts/`：离线预处理和验证入口。
- `data/raw/`：本地原始输入；必须记录来源并遵守再分发规则。
- `data/processed/`：选择资源发布前的开发阶段生成结果。
- `tests/`：确定性测试和已明确标记的合成 fixture。

## 3. 用户流程

1. 应用打开后显示受支持的东京 Demo 区域，并说明地理和数据覆盖限制。
2. 用户在该区域内选择步行起点和终点。
3. 浏览器验证两个点是否可寻路且位于受支持边界内。
4. 浏览器使用同一份版本化静态图计算 Fastest、Balanced 和 Coolest 候选路线。
5. 地图显示替代路线，并展示预计步行时间、距离、Heat Exposure Score 或 Heat Exposure Index，以及相对 Fastest Route 的额外时间。
6. 用户切换不同路线，查看模型因素和已知数据缺口的简明说明。
7. 如果必需数据缺失或无法计算路线，界面必须明确报告该状态，不得显示虚构结果。

## 4. 功能优先级

### P0：黑客松必需

- 使用静态 GitHub Pages 部署，不运行线上后端。
- 一个浏览器可承载的东京23区 Production 范围；Core5 与原 2–3 km Demo 数据保留用于回归和回退。
- 支持起点和终点选择的 MapLibre 地图。
- 使用已记录的真实数据源离线生成浏览器可读步行图。
- 在浏览器端比较 Fastest Route、Balanced Route 和 Coolest Route。
- 边级 Heat Exposure Score 契约与路线级聚合。
- 显示时间、距离、模型热暴露比较和额外时间。
- 可见的覆盖范围、来源、数据缺失和非医疗性免责说明。
- 针对图加载和三种寻路目标的确定性冒烟测试。

### P1：P0 稳定后的高价值功能

- 针对实际可用的阴影、绿地、表面或其他输入进行路段说明。
- 仅在有已记录的真实数据集和明确时间戳语义时，引入时段感知输入。
- 优化紧凑静态资源和加载状态。
- 将可分享的起点/终点状态编码到 URL，不引入用户账户。
- 改进可访问性、键盘导航和移动端布局。

### P2：延后探索

- 通过分别验证的数据包扩展到其他东京社区。
- 时间与暴露权衡的敏感度控件。
- 离线缓存或可安装 PWA。
- 与其他寻路基线的对比评估。

P2 不包括 LLM、登录系统、用户账户、数据库、聊天机器人或服务器基础设施。

## 5. 数据流

```text
已记录的真实数据源
        |
        v
data/raw/ + 来源元数据
        |
        v
离线 Python 验证、裁剪、归一化和空间连接
        |
        v
data/processed/ 版本化图 + 环境属性 + 质量标记
        |
        v
将选定的紧凑静态资源复制到 public/data/
        |
        v
GitHub Pages 提供不可变静态文件
        |
        v
浏览器加载图 -> 计算边代价 -> 查找三种路线
        |
        v
MapLibre 渲染路线，UI 报告比较结果和数据缺口
```

每个数据源适配器必须返回 `available`、`missing` 或 `invalid` 等明确状态，以及来源和覆盖元数据。数据源不可用时，不得用伪造的东京官方数据替代。只有在界面暴露由此带来的质量限制时，下游模型才可以使用已记录的中性回退。

## 6. M5 Heat Exposure Model 定义

### 6.1 边级指标

每条 Edge 的 Modelled Heat Exposure 是 `[0,1]` 内的非医疗性模型环境强度：

```text
edgeHeatExposure = 0.7 × (1 - green_score) + 0.3 × water_penalty
```

`green_score` 和 `water_penalty` 来自 M4 已验证的正式 Edge。字段缺失、NaN、Inf 或越界必须停止计算，不允许 silent fallback。M5 Base Model 没有直接使用气温、湿度、太阳辐射、实时阴影或个人生理条件。M10.5 仅为 Balanced / Coolest 增加固定 Building Shade 环境因素，Fastest 与 M5 Base 指标保持不变。

### 6.2 Shade-aware 边级指标

固定 `shadeContributionWeight = 0.25`：

```text
shadeAwareHeatExposure
= 0.75 × edgeHeatExposure
+ 0.25 × (1 - shade_score)
```

`shade_score` 来自独立 Shade Schema `1.0.0` Sidecar，按 09:00、12:00、15:00 场景读取，不写入 Graph Schema `1.1.0`。Sidecar 未加载时不得伪装为 `shade_score = 0`；UI 必须明确回退为 Green/Water Base Model。

### 6.3 路线级指标

路线显示的 **Heat Exposure Score** 是单位距离上的平均模型环境热暴露强度：

```text
averageHeatExposure = Σ(length × edgeHeatExposure) / Σ(length)
```

范围为 `[0,1]`，值越低表示当前模型估计暴露越低。累计代理量必须另称 **Modelled Exposure Load**：

```text
modelledExposureLoad = Σ(length × edgeHeatExposure)
```

Modelled Exposure Load 没有物理或医疗单位。平均 Heat Exposure Score 下降不保证累计 Load 下降；较长绕行可能降低平均强度但增加累计代理量。

寻路目标的概念表达为：

```text
Fastest:  minimize(totalDistance)
Balanced: minimize(totalDistance + 1 × modelledExposureLoad)
Coolest:  minimize(totalDistance + 3 × modelledExposureLoad)
```

三种模式共用单一 Weighted Dijkstra。lambda 是可配置的 Demo 参数，不是医学阈值。`maximumExtraDistanceRatio = 0.25` 表示最多比 Fastest 多走 25%，但 M5 默认 `null`，Detour Guard 完全关闭。

## 7. 数据不确定性与失败行为

- 拒绝或明确标记 schema、边界或模型版本不兼容的资源。
- 必须区分数据缺失和实测零值。
- 必需特征缺失时，显示低可信度或覆盖不完整状态。
- 图或最小必需模型输入无效时，不得计算表面上很精确的比较结果。
- 路线可用性和热暴露数据可用性是两种不同状态，必须分别报告。
- 保留数据源和模型版本标识，使 Demo 结果可复现。

## 8. 禁止的医疗性表述

CoolRoute Tokyo 不估计或预测个人健康结果。产品文案、图表、演示文稿和文档不得将 Heat Exposure Score 或 Heat Exposure Index 描述为：

- **中暑概率**，或某人发生中暑的概率；
- 诊断、医疗风险分数或临床安全评级；
- 经医学验证的风险降低比例；
- 某条路线能预防疾病或对所有人安全的证明；
- 天气警报、公共卫生指南或个人判断的替代品。

允许的表述只比较受支持区域内的**模型估计热暴露**，并说明实际环境与个人反应可能不同。

## 9. M6 产品界面与退出条件

正式 Demo UI 以日语为主。Desktop 使用窄侧栏 + 主地图，Mobile 使用地图 + 可折叠 Bottom Sheet。Fastest、Balanced、Coolest 三条路线默认同时显示，当前选中路线位于最高路线图层；默认及 Reset 后选中 Balanced。切换 Route Card 只更新选中状态和呈现，不重新运行 Dijkstra。

Heat Exposure Layer 和 Drinking Station Layer 默认关闭并位于路线下方。Heat Exposure Layer 必须调用 M5 唯一的 Edge Exposure Model，不得复制公式；Drinking Station Layer 只表达官方站点位置，不声称路线实际经过。当前没有可用于浏览器图层的 Green Polygon 正式资产，因此不伪造或补建该图层。

M6 在日语文案、三路线 Compare、地图图层顺序、错误隔离、Desktop/Mobile 布局、自动测试和静态生产构建全部通过后完成。M6 不修改 Exposure Formula、Weighted Dijkstra、Route Bundle Schema、Graph Schema 或正式数据，也不进入 M7。详细边界以 `docs/superpowers/specs/2026-08-18-m6-japanese-product-ui-design.md` 为准。
