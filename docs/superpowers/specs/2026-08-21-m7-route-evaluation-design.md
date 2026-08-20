# CoolRoute Tokyo M7 路线评估设计规格

**里程碑：** M7 Route Evaluation
**状态：** 已批准并实施
**稳定基线：** `d172f1cc7b2b00b527f3f2f6e6cd7e1559f117e8`
**Repository：** <https://github.com/katenn0613/CoolRoute_Tokyo>

## 1. 目标与结论边界

M7 建立一套可重复运行、可审计、不会为了展示效果筛选有利案例的路线评价体系。评价对象是当前 Demo Area、当前 Production Graph、当前环境 Edge 字段和当前 M5 路由参数下的 Fastest、Balanced、Coolest 三种路线。

M7 要回答的问题是：

> 在当前 Demo Area 的一般合理 OD 样本中，Balanced 和 Coolest 是否以及在多大比例上，以多少额外步行距离或时间，换取较低的 Average Heat Exposure 或 Modelled Exposure Load？

M7 只能提供当前样本和当前模型下的实证结果，不能证明 CoolRoute 在所有东京路线、所有季节或所有个人条件下普遍有效。评价结果不是中暑概率、医疗风险或医学验证后的风险降低比例。

## 2. 不可变边界

M7 不得修改：

- `weightedDijkstra` 或其他 Routing Algorithm；
- Edge Heat Exposure Formula；
- Green/Water Weight；
- Balanced/Coolest lambda；
- Walking Speed；
- Detour Guard 默认配置；
- Browser Graph Schema；
- Production Graph 的 Edge Score；
- 当前 Demo Area。

M7 不为得到更明显的路线差异而修改真实数据，不根据是否出现 Trade-off 决定样本是否进入正式结果。

## 3. 采用方案

M7 使用离线 Node.js Evaluation Pipeline，直接复用正式浏览器 Routing 模块：

```text
public/data/graph.json
        ↓
prepareGraph()
        ↓
确定性分层 OD Sampler
        ↓
calculateRouteBundle()
        ↓
现有 Route Metrics + Route Comparison
        ↓
确定性结果序列化
        ↓
evaluation_results.json
evaluation_summary.json
docs/EVALUATION_SUMMARY_JA.md
```

不采用 Python/NetworkX 重算路线，因为第二套算法可能与正式浏览器 Weighted Dijkstra 漂移。不采用浏览器 UI 批量运行，因为它会增加自动化、文件输出和可复现性成本。

## 4. 文件与职责

计划新增：

```text
scripts/
  evaluate_routes.mjs              # 正式命令入口、读取 Graph、原子发布
  evaluation/
    sampler.mjs                    # 确定性随机数、OD 门禁、距离分层
    summary.mjs                    # 统计分布、路线相同率、阈值表
    serializer.mjs                 # 数值规范化、稳定 JSON、日语 Markdown

evaluation/
  evaluation_results.json          # 90 组逐 OD 正式结果
  evaluation_summary.json          # 聚合统计和阈值统计

docs/
  EVALUATION_SUMMARY_JA.md          # 面向评委和使用者的日语摘要

tests/javascript/
  evaluationSampler.test.js
  evaluationSummary.test.js
  evaluationSerializer.test.js
```

`package.json` 新增：

```json
"evaluate:routes": "node scripts/evaluate_routes.mjs"
```

Evaluation 模块不得进入浏览器 Production Bundle。它只在开发/评价阶段运行。

## 5. 输入契约

唯一正式输入是：

```text
public/data/graph.json
```

脚本必须通过现有 `prepareGraph()` 建立和浏览器一致的 Graph 结构，并通过现有 `calculateRouteBundle()` 计算三种路线。

Metadata 至少记录：

- `evaluationSchemaVersion = "1.0.0"`；
- Browser Graph Schema Version；
- `graph.json` SHA-256；
- Graph node/edge count；
- Demo Area ID 和 Bounding Box；
- Random Seed；
- OD 分层与门禁；
- Routing Config 完整快照；
- `edgeScoresModified = false`；
- `routingAlgorithmModified = false`；
- `exposureFormulaModified = false`。

正式输出不得记录本机绝对路径、用户名、运行时间戳或临时目录。

## 6. OD 抽样设计

### 6.1 固定参数

```text
Random Seed = 20260821
Target OD Count = 90
Maximum Attempts = 100000
```

Graph Node 在抽样前按字符串 Node ID 稳定排序，再使用仓库内实现的确定性伪随机数生成器选择 Start 和 Destination。

### 6.2 距离分层

分层依据是正式 Fastest Route 的 `distanceMeters`：

| Stratum | Fastest Distance | Target |
|---|---:|---:|
| `short` | `400 <= d < 1000 m` | 30 |
| `medium` | `1000 <= d < 2000 m` | 30 |
| `long` | `2000 <= d <= 3500 m` | 30 |

边界只属于一个 Stratum。总样本必须正好为 90。

### 6.3 候选门禁

候选 OD 必须满足：

1. Start 与 Destination 不同；
2. Start/Destination 均为 Production Graph 的真实 Node；
3. 同一个有向 `startId → destinationId` 不重复；
4. 直线距离位于 `[350, 1800] m`；
5. 三种路线均能由现有 `calculateRouteBundle()` 成功计算；
6. Fastest Distance 位于 `[400, 3500] m`；
7. `fastestDistance / straightDistance <= 3`；
8. 目标 Stratum 尚未满 30 组。

OD 是有方向的，因此 `A → B` 与 `B → A` 是不同候选。样本接纳逻辑不得读取：

- Fastest/Balanced/Coolest 是否相同；
- Exposure 是否降低；
- Load 是否降低；
- Extra Distance 是否看起来有利；
- Green/Water Indicator 是否变化。

脚本记录各类拒绝原因计数，使抽样过程可审计。若 100000 次尝试后任一 Stratum 不足 30 组，Evaluation 明确失败且不发布新文件。

## 7. 单个 OD 结果契约

`evaluation_results.json` 每个 Case 至少包含：

- `id`；
- `stratum`；
- Start/Destination Node ID；
- Start/Destination `[lon, lat]`；
- `straightDistanceMeters`；
- 三条路线结果；
- Balanced/Coolest 相对 Fastest 的 Comparison；
- 路线相同标记。

每条路线记录：

- `mode`；
- `distanceMeters`；
- `walkingTimeSeconds`；
- `edgeCount`；
- `averageHeatExposure`；
- `modelledExposureLoad`；
- `greenIndicator`；
- `waterAccessIndicator`；
- `totalCost`；
- `edgeIds`。

Comparison 继续使用现有语义：

- `extraDistanceMeters`；
- `extraDistancePercent`；
- `extraWalkingMinutes`；
- `averageHeatExposureChange`；
- `averageHeatExposureReduction`；
- `averageHeatExposureReductionPercent`；
- `modelledExposureLoadChange`；
- `modelledExposureLoadReduction`；
- `modelledExposureLoadReductionPercent`。

`Exposure Reduction` 在 M7 文档中明确指 Average Heat Exposure Reduction；`Load Reduction` 明确指 Modelled Exposure Load Reduction。二者不得混用。

路线相同使用完整 Edge ID Sequence 精确比较，至少生成：

- `fastestEqualsBalanced`；
- `fastestEqualsCoolest`；
- `balancedEqualsCoolest`；
- `allThreeEqual`。

## 8. 确定性与数值规范化

正式 JSON 不保存：

- `calculationTimeMs`；
- Search Time；
- `generatedAt`；
- Node.js 进程信息；
- 文件绝对路径。

所有有限浮点数在进入正式 Results 后统一规范化到最多 12 位小数，规范化后的负零写为 `0`。Summary 必须从规范化后的 Results 计算，保证读者能够只依靠 `evaluation_results.json` 重新得到相同 Summary。

JSON 使用固定字段插入顺序、两个空格缩进和结尾换行。相同 Graph、Seed、Config 和代码版本重复运行时，三个正式输出应逐字节一致。

## 9. Summary 设计

`evaluation_summary.json` 至少包含：

### 9.1 样本完整性

- 总样本数；
- 各 Stratum 样本数；
- 尝试次数；
- 各拒绝原因计数；
- Graph SHA-256；
- Seed 和 Routing Config。

### 9.2 路线重合率

- Fastest == Balanced 数量和比例；
- Fastest == Coolest 数量和比例；
- Balanced == Coolest 数量和比例；
- 三条路线全部相同数量和比例；
- 三条路线并非全部相同数量和比例。

### 9.3 三种路线绝对指标

分别对 Fastest、Balanced、Coolest 的下列字段输出 `min`、`mean`、`median`、`p25`、`p75`、`p90`、`max`：

- Distance；
- Walking Time；
- Average Heat Exposure；
- Modelled Exposure Load；
- Green Indicator；
- Water Access Indicator；
- Edge Count。

### 9.4 Balanced/Coolest 对比

分别对 Balanced 和 Coolest 统计：

- Average Heat Exposure 降低数量和比例；
- Modelled Exposure Load 降低数量和比例；
- 两者同时降低数量和比例；
- Average 降低但 Load 增加的数量和比例；
- 没有改善或指标增加的数量和比例。

以下字段输出 `min`、`mean`、`median`、`p25`、`p75`、`p90`、`max`：

- Extra Distance Meters；
- Extra Distance Percent；
- Extra Walking Minutes；
- Average Heat Exposure Reduction；
- Average Heat Exposure Reduction Percent；
- Modelled Exposure Load Reduction；
- Modelled Exposure Load Reduction Percent；
- Green Indicator Change；
- Water Access Indicator Change。

其中 Green/Water Change 均定义为 `candidate - fastest`。正值只表示对应代理指标变高，不得自动解释为 Average Heat Exposure 或 Modelled Exposure Load 已降低。

分位数采用线性插值法，并由单元测试锁定定义。`null` 百分比不参与数值分布，同时记录 Null Count。

## 10. Detour Threshold 表

M7 不擅自把某一个阈值定义为“合理绕路”。Summary 同时输出：

### Extra Distance Percent

- `<= 5%`；
- `<= 10%`；
- `<= 15%`；
- `<= 25%`。

### Extra Walking Time

- `<= 1 minute`；
- `<= 3 minutes`；
- `<= 5 minutes`。

每个模式、每个阈值记录：

- `eligibleCount`；
- `eligibleRateOfAllSamples`；
- `averageExposureReducedCount`；
- `averageExposureReducedRateWithinEligible`；
- `loadReducedCount`；
- `loadReducedRateWithinEligible`；
- `bothReducedCount`；
- `bothReducedRateWithinEligible`。

这样报告展示不同绕路容忍度下的实际模型表现，不通过事后选择一个最有利阈值制造结论。

## 11. 日语评价报告

`docs/EVALUATION_SUMMARY_JA.md` 由正式 Summary 确定性生成，至少包括：

1. 評価目的；
2. 対象エリア；
3. 90 組 OD 的抽样方法；
4. 路線重合率；
5. Balanced/Coolest 的距离、时间和模型指标结果；
6. Detour Threshold 表；
7. Average Heat Exposure 与 Modelled Exposure Load 的区别；
8. Green/Water 数据和 Demo Area 限制；
9. 非医疗性声明；
10. 仅适用于当前模型和样本的结论。

日语报告使用：

- `平均暑さ曝露スコア`；
- `モデル上の累積暑さ曝露`；
- `モデル上の暑さ曝露`；
- `比較不可`。

禁止使用中暑概率、医学风险下降或保证安全等表述。

## 12. 验证与原子发布

正式发布前必须验证：

1. Results 正好 90 个 Case；
2. 三个 Stratum 各 30；
3. 没有重复有向 OD；
4. 每个 Node ID 存在；
5. 每条路线 Edge Sequence 非空；
6. Distance、Time、Load、Cost 非负且有限；
7. Average Heat Exposure、Green Indicator、Water Access Indicator 位于 `[0,1]`；
8. Comparison 可由 Results 重新计算；
9. Summary 可由 Results 重新计算；
10. Metadata Graph Hash 与正式输入一致；
11. 两次运行输出逐字节一致。

Pipeline 先在内存中生成和验证三个完整文本，再为每个目标写入同目录临时文件。由于 JSON 和 Markdown 位于不同目录，不能把多个 rename 描述为文件系统级单操作原子性。发布过程采用事务式替换：替换前备份既有正式文件，依次 rename 临时文件；任一步骤失败时恢复全部备份并删除临时文件。首次发布失败时不得留下部分正式输出。单元测试必须注入中途失败并验证回滚。

## 13. 自动测试

至少覆盖：

1. 同一 Seed 产生相同候选序列；
2. 不同 Seed 产生不同候选序列；
3. Node 排序不受输入 Map 插入顺序影响；
4. Stratum 边界唯一且正确；
5. 三层目标各 30；
6. 同一有向 OD 不重复；
7. 接纳逻辑不读取 Trade-off 字段；
8. 任一 Stratum 不足时明确失败；
9. Mean/Median/Percentile 正确；
10. 负 Reduction 不会被算作改善；
11. `null` Percent 不产生 NaN；
12. Threshold 分母使用 eligible sample；
13. Results 和 Summary Schema Validation；
14. 稳定序列化逐字节一致；
15. 多文件发布中途失败会恢复旧输出；
16. Production Evaluation 输出通过完整验证。

最终执行：

```bash
npm run evaluate:routes
npm test -- --run
npm run build
```

M7 不需要 Python GIS 重处理，因为它不修改 Graph 或环境数据。

## 14. Git 范围

M7 最终 Commit Message：

```text
feat: add route evaluation pipeline
```

只暂存 M7 新增或明确修改的文件。当前已存在的用户修改：

```text
docs/superpowers/plans/2026-08-17-m1-map-and-data-sources.md
```

必须保留在工作区，不得混入 M7 Commit，不得还原、覆盖或删除。

M7 完成测试、构建、产物验证和代码审阅后 Push 到现有 `origin/main`。不得创建新 Repository，不得进入 M8。

## 15. 完成条件

M7 只有在以下条件全部满足后才完成：

- 90 组确定性分层 OD 成功生成；
- Results、Summary 和日语报告通过验证；
- 没有根据 Trade-off 筛选样本；
- Routing、Exposure、Weight、Lambda 和 Graph Schema 未改变；
- 完整 JavaScript Tests 通过；
- Production Build 通过；
- M7 Commit 不包含用户已有的 M1 文档修改；
- Commit 成功 Push 到 `origin/main`；
- 工作区只保留用户原有的未提交修改；
- 停止，不进入 M8。
