# M6 日语正式产品 UI 设计规格

## 1. 阶段目标

M6 将 M0～M5 已完成的技术 Demo 重构为面向日本比赛评审和日本用户的静态 Hackathon Demo 产品。M6 只改变产品呈现、地图图层和用户可见交互，不修改 M5 Exposure Formula、Weighted Dijkstra、Route Bundle Schema、正式 Road Graph 或环境数据。

正式应用继续使用 React、Vite、JavaScript 和 MapLibre GL JS，完整部署到 GitHub Pages。运行时不增加 API、后端服务器、数据库、Node Server 或其他线上基础设施。

## 2. Production UI 语言

Production UI 以日语为第一语言。导航、按钮、路线名称、指标、状态、错误、空状态、Loading、数据来源、计算方法和 Disclaimer 均使用自然简洁的日语。允许保留 CoolRoute Tokyo、OpenStreetMap、Heat Exposure Score、GitHub、官方英文数据集名称和必要技术缩写。

禁止在 Production UI 中残留中文，也避免无必要的日英混排。内部代码、Enum 和 Schema 继续使用英文标识符。

### 2.1 核心文案

```text
CoolRoute Tokyo

暑い日の徒歩移動を、もっと快適に。

最短ルートと、
緑や給水スポットを考慮したルートを比較します。
```

路线名称固定为：

- `fastest`：`最短ルート`
- `balanced`：`バランスルート`
- `coolest`：`涼しさ優先ルート`

不得将 Coolest 严格定义为 `最も涼しいルート`。它仍是以更高权重偏向低模型热暴露的距离—暴露折中路线。

### 2.2 Exposure 术语

- `averageHeatExposure`：`平均暑さ曝露スコア`
- `modelledExposureLoad`：`モデル上の累積暑さ曝露`
- Methodology 中的技术概念：`暑さ曝露指標`
- `greenIndicator`：`緑の多さ`
- `waterAccessIndicator`：`給水スポットへのアクセス`

`緑の多さ` 不得写成木陰率；`給水スポットへのアクセス` 不得写成给水点数量或路线实际经过的站点。

## 3. 页面结构

### 3.1 Desktop

页面使用窄侧栏加主地图布局：

- 左侧控制面板目标宽度约 360～400 px，可纵向滚动；
- 右侧 MapLibre 地图占据主要视觉面积；
- 控制面板按品牌说明、选点状态、三路线卡片、主路线详情、Trade-off、操作、使用数据和计算方法排列；
- 使用数据和计算方法默认采用紧凑折叠内容，避免压缩核心路线流程。

### 3.2 Mobile

- 地图占据主要视口；
- 路线面板作为底部 Bottom Sheet 覆盖地图下方；
- 使用明确的展开/收起按钮，不实现拖拽手势；
- Bottom Sheet 内部纵向滚动；
- Route Card 纵向排列，不出现横向溢出；
- 按钮和可选卡片保持至少 44 px 的触控目标；
- 日语长标签允许自然换行，数字、百分比和单位不得溢出。

## 4. 用户流程和状态

用户流程保持 M3/M5 的事务性选择语义：

1. `地図上で出発地を選択してください`
2. `地図上で目的地を選択してください`
3. 自动一次计算 Fastest、Balanced 和 Coolest Route Bundle
4. 显示 `3つのルートを比較できます`
5. 用户通过 Route Card 切换选中路线
6. 用户可执行 `出発地を変更`、`目的地を変更`、`再計算` 和 `リセット`

重新选择状态使用：

- `新しい出発地を選択してください`
- `新しい目的地を選択してください`

内部 `awaiting-start`、`selecting-destination` 等状态名不得显示。重新选择失败时必须保留原 Start、Destination 和 Route Bundle。

默认 `selectedMode` 为 `balanced`；Reset 后恢复 `balanced`。Route Card 切换只改变选中模式和展示，不重新运行 Dijkstra。路线只在 Start、Destination 或未来真正影响 Routing Cost 的模型参数变化时重新计算。

## 5. Route Card、详情和 Trade-off

每张 Route Card 至少显示：

- 路线名称；
- 所要時間；
- 距離；
- `平均暑さ曝露スコア`，必要时以 `Heat Exposure Score` 作辅助。

当前选中卡片使用清晰的选中边框、状态文字和对应路线样式。主 Route Detail 显示：

- 所要時間；
- 距離；
- 平均暑さ曝露スコア；
- モデル上の累積暑さ曝露；
- 緑の多さ；
- 給水スポットへのアクセス。

Balanced 或 Coolest 相对 Fastest 的主要 Trade-off 必须来自 `modelledExposureLoadReductionPercent`：

```text
約1分多く歩くことで、モデル上の累積暑さ曝露を8%低減
```

Average Heat Exposure 的变化必须另写为：

```text
平均暑さ曝露スコア −5%
```

不得混用两种百分比。如果基准为零导致百分比为 `null`，或者值为 NaN/Infinity，UI 显示 `比較不可`，不得显示 `0%`、`NaN%` 或 `Infinity%`。

## 6. 统一日语 Formatter

新增单一 Formatter 模块，集中处理：

- 小于 1 km 的距离显示为整数 `m`；
- 大于等于 1 km 的距离显示为紧凑 `km`；
- Walking Time 显示为 `18分`；
- 不足一分钟的额外时间使用秒，避免四舍五入成 `0分`；
- 百分比使用有限数检查和统一精度；
- 缺失或不可比较值显示 `比較不可` 或 `—`。

组件不得各自重复实现距离、时间和百分比格式。

## 7. 地图 Compare 模式

Route Bundle 就绪后默认同时显示三条真实路线：

- Fastest Background Route；
- Balanced Background Route；
- Coolest Background Route；
- Selected Route Layer。

Selected Route Layer 重复引用当前选中路线的真实 GeoJSON，仅用于顶层高亮。不得平移、偏移或修改 Route Geometry。

三种路线不能只靠颜色区分，必须组合：

- 实线 / 短虚线 / 长虚线；
- 不同线宽；
- 不同透明度；
- 地图 Legend 和 Route Card 标签。

所有颜色、线宽、透明度和 dash pattern 统一存放在 `presentationConfig`，Routing Logic 不得依赖呈现配置。

点击 Route Card 更新 `selectedMode`、Selected Route Layer、Route Detail 和 Trade-off，不重新计算 Route Bundle。点击地图路线反向选择 Route Card 不属于 M6 必须项。

## 8. 地图图层 Z-order

固定图层顺序从下到上为：

1. OSM Basemap；
2. Heat Exposure Layer；
3. Drinking Station Point Layer；
4. Fastest Background Route；
5. Balanced Background Route；
6. Coolest Background Route；
7. Selected Route Layer；
8. Start / Destination Marker。

Heat Exposure Layer 必须使用较细线宽和较低透明度，避免覆盖底图或路线。Marker 继续由 MapLibre Marker DOM 覆盖物实现，视觉上始终位于 Map Style Layers 上方。

## 9. Heat Exposure Layer

`src/routing/exposureLayer.js` 只承担正式 Graph 到 GeoJSON 的呈现转换：

```text
Production Graph
  -> 读取正式 Edge
  -> 调用 M5 calculateEdgeHeatExposure(edge, config)
  -> 生成包含 heatExposure 属性的 GeoJSON
```

不得在 Exposure Layer 模块内复制 `0.7 × (1-green_score) + 0.3 × water_penalty`。Exposure Formula 的唯一正式来源继续是 M5 `exposureModel.js`。

FeatureCollection 只在 Graph 加载或模型配置真正变化时生成一次，不得在无关 React render 中反复构建。图层默认关闭，Legend 使用 `低い → 高い`，不得使用安全/危险。

## 10. Drinking Station Layer 和 Green 边界

Drinking Station Layer 默认关闭，使用 GitHub Pages compatible path 加载现有 `public/data/drinking_stations.geojson`，显示 Demo Area 内正式发布的 5 个官方 Point。

M6 不建立 Green Polygon Layer。当前没有正式发布的浏览器 Green Polygon 资源，不得把 Edge `green_score` 错误包装成绿色区域。Green 数据仍用于正式 Edge Exposure、路线指标、Methodology 和 Data Sources 说明。

## 11. 使用数据与计算方法

删除 M1 开发用 Data Status、Ready/Pending Badge 和技术阶段文案。正式 `使用データ` 显示：

- OpenStreetMap；
- 東京都「緑のオープンデータ（GISデータ）」；
- 東京都水道局「Tokyowater Drinking Station」。

名称、发布机构和链接必须与 `docs/DATA_SOURCES.md`、Registry 和 `environment_metadata.json` 一致。

`計算方法` 使用以下简洁说明：

```text
CoolRoute Tokyo は、道路距離、緑地データ、給水スポットへの近さを用いて
道路ごとのモデル上の暑さ曝露指標を計算し、徒歩距離とのバランスを考慮して
ルートを探索します。
```

Disclaimer 固定包含：

```text
本サービスの「暑さ曝露スコア」は、公開データをもとにしたモデル上の環境指標であり、
熱中症の発症確率や医学的リスクを予測するものではありません。
実際の環境や通行状況はモデルと異なる場合があります。
```

## 12. 错误与 Loading 隔离

底层 Error 可以保留技术信息供 Console 和测试使用，但不得将 `Exception.message` 直接显示给用户。用户错误分类为：

- Graph Load：`道路データの読み込みに失敗しました。`
- Outside/Snap：`対象エリア内の道路付近を選択してください。`
- No Route：`ルートを見つけることができませんでした。`
- Invalid Point：`別の地点を選択してください。`
- Generic：`処理に失敗しました。もう一度お試しください。`

Loading 文案统一为：

- `道路データを読み込んでいます…`
- `ルートを計算しています…`

若同步路由计算短到不足以稳定显示 Loading，不得通过人为延迟降低体验；但必须保留明确的计算中状态契约和 `aria-live` 状态。

## 13. Hook 和模块命名

现有 `useFastestRoute.js` 实际负责 Graph 加载、三路线 Route Bundle、选择状态和呈现派生数据，命名已不符合职责。M6 将其重命名为：

```text
src/routing/useRouteBundle.js
export function useRouteBundle(...)
```

所有 Production import 和测试同步迁移，不保留一个实际管理三路线却命名为 `useFastestRoute` 的兼容 Hook。

## 14. 性能要求

- Road Graph 只加载一次；
- 每次有效 Start/Destination 组合只计算一次三模式 Route Bundle；
- Route Card 切换不得触发路由计算；
- Route GeoJSON 复用 M5 结果；
- Exposure FeatureCollection 只在 Graph/正式模型配置变化时构建；
- Map Source 使用 `setData` 更新，不重建 Map；
- Heat Layer 和 Drinking Layer 默认关闭；
- 优化必须以测量为依据，不增加无必要缓存框架或依赖。

## 15. 可访问性和排版

- 使用系统日文字体栈，不下载大型字体；
- 路线必须同时通过颜色、dash pattern、线宽和标签区分；
- 所有按钮提供可见 Focus 状态；
- Route Card 使用原生可访问控件；
- 状态和错误使用 `aria-live` / `role="alert"`；
- 地图 Layer Toggle 具有可读 Label 和 checked 状态；
- 确保 320 px 宽度无横向页面溢出。

## 16. 测试与验收

自动测试至少覆盖：

- 日语 Start、Destination、Route Ready、重新选择状态；
- 默认和 Reset 后选择 Balanced；
- 三 Route Card 切换且不重新计算；
- 三路线 Background Layer 和 Selected 顶层 Layer；
- 固定 Z-order；
- Marker 位于 Map Style Layer 之上；
- Trade-off 使用 Modelled Exposure Load Reduction；
- Average Exposure 百分比独立；
- `null` 百分比显示 `比較不可`；
- 日语 Error 分类，不泄露技术 Exception；
- Heat Exposure GeoJSON 调用正式 Exposure Model；
- Heat 和 Drinking Toggle 默认关闭；
- Reset 和事务性重新选择回归；
- GitHub Pages compatible asset path。

完成前必须运行：

```text
npm test -- --run
npm run build
```

并使用真实浏览器检查 Desktop 和 Mobile：按钮可点击、Bottom Sheet 可展开/收起、地图仍可操作、日语无横向溢出、三路线视觉层级正确、环境图层不覆盖路线。

## 17. M6 非目标

M6 不实现：

- M7 参数实验；
- 新 Exposure Formula；
- Shade、Weather 或 PLATEAU；
- 新 Green Polygon 数据发布；
- 路线 Geometry 偏移；
- 多语言/i18n 系统；
- 路线附近 Drinking Station 数量；
- 后端、数据库、账号、登录、LLM 或聊天机器人。

M6 完成后停止，不进入 M7。
