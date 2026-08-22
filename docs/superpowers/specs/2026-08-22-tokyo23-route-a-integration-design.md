# Tokyo23 Route A 实验运行时整合设计

## 目标

在当前 `main` 的 React/UI、Core5 Production、三语 README 和 Pages Workflow 基础上，移植 `dev/route-a-perf` 的紧凑二进制路网、Web Worker Routing 与 Heat/Shade MVT 图层。Core5 保持正式默认 Dataset；Tokyo23 只能通过 `?dataset=tokyo23-route-a` 显式启用为实验运行时，并在初始化失败时回退 Core5。不提交约 288MB 的全量源 JSON。

## 数据契约

- Tokyo23 Runtime Graph：`graph_tokyo23.bin.gz`，Binary Schema Version `1`；`graph_tokyo23.bin` 作为不支持 `DecompressionStream` 时的 fallback。
- Binary 内容：409,472 Node、1,206,772 Edge、Green、Water、真实 Edge Geometry 与 09:00/12:00/15:00 Shade。
- 图层：`public/data/tiles/heat/` 与 `public/data/tiles/shade/` MVT。
- Runtime Metadata：`graph_tokyo23_runtime_metadata.json` 明确记录 Binary Schema、数量、Bounds、20 个弱组件和源 JSON 未保留事实。
- Core5 的五个正式静态资产继续保留，不覆盖、不改 Schema。

## 浏览器架构

- `useRouteBundle` 根据 Dataset Config 使用 `routeEngine`；Tokyo23 由 Worker 加载/解压 Binary、建立邻接表、Snap 和计算三模式路线。
- Fastest 仍只读取距离；Balanced/Coolest 继续使用现有 M10.5 固定公式与 lambda，不修改模型。
- Heat/Shade 图层改为 MVT；Drinking Station 继续读取静态 GeoJSON。
- 初始化失败时自动回退 Core5；不把 Shade 缺失伪装为 0。
- Tokyo23 Start/Destination 暂按正式 Bounding Box 限制；metadata 明确真实 Union Polygon 尚未提供。

## 已知限制

- Tokyo23 Binary Graph 有20个弱组件。页面和图层可以覆盖23区，但跨组件 OD 会明确返回不可达；不得表述为任意两点均可路由。
- Binary 由未入库的全量 JSON 构建，无法从仓库重新生成；现有 Binary、Metadata 和 SHA 用作最终 Runtime Artifact。
- 范围是东京23区，不是整个东京都。

## 验收

- Binary Decoder 验证 Header、大小、值域与错误输入。
- Worker Routing 与 legacy synthetic graph 在 Fastest/Exposure 行为上等价。
- 线上构建只加载 Binary Runtime，不加载旧问题 `graph_tokyo23.json`。
- Tokyo23 至少完成实际 Binary 路由冒烟验证；跨组件 OD 返回明确错误而非崩溃。
- Core5 资产和 Loader 测试继续通过。
- Pages Subpath Build 和 Artifact Validation 通过。
