# 开发分支使用说明（dev/route-a-perf）

> 本分支 = `main` + **Route A 前端性能优化**（Web Worker 路由 / 紧凑二进制图 / MVT 瓦片图层）+ 数据重建管线修复 + UI 调整。
> 适用于想拿到当前开发进度并本地运行的协作者。

## 1. 克隆开发分支

```bash
git clone -b dev/route-a-perf git@github.com:katenn0613/CoolRoute_Tokyo.git
cd CoolRoute_Tokyo
```

（HTTPS 方式：`git clone -b dev/route-a-perf https://github.com/katenn0613/CoolRoute_Tokyo.git`）

## 2. 安装依赖

```bash
npm install
```

只需要 Node.js 环境（npm install 时会安装 geojson-vt / vt-pbf 等瓦片构建依赖）。

## 3. 启动本地开发服务器

```bash
npm run dev
```

打开 **http://localhost:5173/** 。

- 地图 + 热暴露/阴影图层 + 三模式路由都是前端本地计算（Web Worker），**不需要任何后端、Python 或 conda**；
- 前端读取的静态产物（`public/data/graph_tokyo23.bin.gz` 二进制图、`public/data/tiles/` 瓦片、饮水点等）**已随分支提交**，克隆后即可直接运行，无需重建数据；
- 当前分支数据为 **东京 23 区全量**（1,206,772 条边，含此前缺失的台東/北/板橋/荒川/足立/葛飾等区），热暴露图层全东京可见；
- 阴影（PLATEAU）仍在管线处理中，当前为**无阴影模式**（路由用绿地/给水，界面会如实提示阴影不可用）；
- ⚠️ 23 区 `graph_tokyo23.json`（288MB）超过 GitHub 单文件 100MB 上限，**未提交到仓库**（保留在数据管线本地工作区）。运行时不读该文件，前端只读二进制图，不受影响；如需用 `npm run build:graph` 重新生成二进制，需先从管线拿到该 JSON。

## 4. 测试与构建

```bash
npm test -- --run          # 前端测试（含二进制路由与 legacy 一致性测试）
npm run build              # 生产构建
```

## 5. 常见问题

| 现象 | 说明 |
|---|---|
| 地图上部分区域选不中点 | 吸附半径 300m，水边/郊区路网稀疏处可能选不到，属正常 |
| 想看阴影感知路由 | 阴影数据（PLATEAU）仍在管线中处理，当前分支为"无阴影模式"（base-only 路由，界面会如实提示） |
| 想重新生成二进制图/瓦片 | `npm run build:graph` / `npm run build:tiles`（从 `public/data/*.json` 生成，需先有 graph/shade JSON） |

## 6. 相关文档

- [文档索引](README.md)
- [后端化方案（路线 A/B）](BACKEND_PLAN.md)
- [Tokyo23 数据覆盖问题排查](TOKYO23_DATA_ISSUES.md)
- [Tokyo23 数据重建交接说明](TOKYO23_DATA_REBUILD_GUIDE.md)（数据管线负责人看）
