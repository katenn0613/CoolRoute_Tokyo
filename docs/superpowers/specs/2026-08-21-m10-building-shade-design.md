# CoolRoute Tokyo M10 Building Shade 设计规格

**状态：** 已审阅通过，包含 2026-08-21 实施前调整  
**范围：** 当前皇居东侧—丸之内—东京站 Demo Area  
**正式数据源：** Project PLATEAU 千代田区 2023 CityGML

## 1. 目标与边界

M10 使用 Project PLATEAU 官方建筑 LOD Geometry 离线预计算三个固定场景的道路中心线建筑阴影比例，并发布适合 GitHub Pages 的独立 `public/data/shade.json`。浏览器只加载轻量静态数据，不解析 CityGML，也不实时计算太阳阴影。

M10 不修改：

- `public/data/graph.json`、Road Graph 拓扑和 Browser Graph Schema 1.1.0；
- Dijkstra、Fastest/Balanced/Coolest Cost 和 Heat Exposure Formula；
- `green_score`、`water_penalty`；
- 当前 Demo Area；
- Weather 或 Tokyo Scale 功能。

## 2. 正式决策

- Building Height 唯一正式来源为所选 PLATEAU LOD Geometry 的有效 Z 范围：`max(Z) - min(Z)`。
- `measuredHeight` 仅用于 QA 对比，`-9999`、空值和异常值均不参与 Shade。
- 完整 LOD2 优先；否则整栋建筑回退完整 LOD1；同一 Building 禁止混合 LOD。
- 第一版 CityGML Parser 只支持当前官方样本实际需要的内联 Geometry 和 Building 内必要 `xlink:href`，不建设通用跨文件引用系统。
- 固定场景为 `2026-09-23`、`Asia/Tokyo`、09:00/12:00/15:00。
- `generatedAt` 仅作溯源，不参与分数、缓存键、排序、测试快照或可复现性判断。

## 3. 数据流

```text
PLATEAU 官方 CityGML 网格
  -> 流式解析 Building / BuildingPart / 必要 xlink
  -> 完整 LOD2，否则整栋 LOD1
  -> EPSG:6677 三维外壳与 Geometry Height 验证
  -> 固定三场景太阳方位与高度
  -> 三维外壳平行投影与 Shadow Polygon union
  -> Road Edge 中心线相交长度比例
  -> shade.json 原子发布
  -> 浏览器按场景惰性加载并绘制 Shade Layer
```

## 4. CityGML 与 LOD

解析采用标准库 XML `iterparse`，按 Building 释放元素，支持当前数据需要的 `Building`、`BuildingPart`、`lod1Solid`、`lod2Solid`、`boundedBy`、`Polygon`、`LinearRing`、`pos`、`posList` 和 Building 子树内 `xlink:href`。坐标顺序服从 `srsName`，Polygon 内环必须保留，未解析必要引用会使该 LOD 无效。

完整 LOD2 要求整栋 Building 或全部相关 BuildingPart 的外壳可解析、XYZ 有限、Ring 闭合、Z Range 为正且没有必要表面缺口。任一相关 Part 的 LOD2 不完整时，放弃整栋 LOD2 并验证完整 LOD1。两者均无效且可能影响 production Road Edge 时，构建失败，不使用属性高度或模拟值补齐。

输入空间范围不能只等于 Demo bounding box。流水线以 production Road Graph Geometry Envelope 为目标，先处理相交网格及一圈相邻网格，再以最低太阳高度和 Geometry 最大投影距离验证外部建筑覆盖；不足时增量扩展官方网格。

## 5. 高度、太阳与阴影

Building QA Height 聚合所选 LOD 的 Building、BuildingPart 和正式纳入的外部 BuildingInstallation 的全部有效 Z。阴影投影按各闭合 Solid/Part 的 GroundSurface 最低有效 Z 为局部地面；LOD1 使用 Solid 最低 Z。

太阳位置使用公开的 Meeus/NOAA 确定性太阳几何公式和固定 Demo 中心经纬度，并采用 NREL SPA 的方位角定义，输出未应用大气折射修正的几何方位角与高度角。实现以 NREL/TP-560-34302 公开参考案例进行 0.1 度误差验收，但不宣称达到 NREL 官方 C 实现的 0.0003 度不确定度。三个场景均使用 JST；太阳高度小于等于零时停止构建。

令太阳方位角 `A` 从正北顺时针、太阳高度角为 `alpha`、XY 分别向东和向北：

```text
d = (z - groundZ) / tan(alpha)
xShadow = x - d * sin(A)
yShadow = y - d * cos(A)
```

每个 Solid 的全部有效外部边界面沿反太阳方向投影，随后按 Building、网格和场景分块 union。最终扣除 Building Ground Footprint，使阴影表示建筑外部地表的模型几何阴影。M10 不模拟天气、树荫、地形遮挡、材质、辐射强度或室内/地下道路。

## 6. Edge Shade Score

每条有向 MultiEdge 独立计算：

```text
shadeScore(t) = length(edge geometry intersect shadow union at t)
                / projected edge geometry length
```

空间计算使用 EPSG:6677。分母使用投影后的真实 Edge Geometry 长度，原 `edge.length` 不变。阴影先 union，避免重叠重复计算；不对道路加 Buffer，因此它是道路中心线建筑阴影比例代理值，不是整个人行道遮阴比例。

## 7. `shade.json` 契约

```json
{
  "metadata": {
    "schemaVersion": "1.0.0",
    "dataset": "Project PLATEAU Chiyoda-ku 2023",
    "provider": "国土交通省 Project PLATEAU",
    "sourceDatasetId": "plateau-13101-chiyoda-ku-2023",
    "referenceDate": "2026-09-23",
    "timezone": "Asia/Tokyo",
    "scenarios": ["09:00", "12:00", "15:00"],
    "solarAlgorithm": "Meeus/NOAA solar geometry (NREL SPA azimuth convention)",
    "lodPolicy": "complete-lod2-else-complete-lod1",
    "heightSource": "geometry-z-range",
    "roadGraphSchemaVersion": "1.1.0",
    "roadGraphGeneratedAt": "...",
    "edgeCount": 16046,
    "solarPositions": {},
    "quality": {}
  },
  "edgeShadeScores": {
    "edge-id-u-v-key": [0.21, 0.73, 0.08]
  }
}
```

数组顺序严格对应 `metadata.scenarios`。production graph 的每个 Edge ID 必须恰好出现一次，不允许未知 ID、缺失 ID、NaN、Infinity 或 `[0,1]` 外数值。全部空间计算后统一保留四位小数。`shade.json` 不重复 Geometry，不发布 Shadow Polygon。

确定性内容包括场景、太阳位置、LOD 决策、质量计数和 Edge Score。`generatedAt` 可变化，但不得参与这些值或确定性测试；测试比较时显式忽略该字段。

## 8. 性能、存储和发布

- 仅提取当前影响范围需要的官方 `bldg/*.gml` ZIP Entry，不长期保存完整千代田区 ZIP。
- Raw 保持原始字节并由 `.gitignore` 排除；中间 Geometry/Shadow 按网格和场景分区，支持断点续跑。
- XML 按 Building 流式释放；Shadow 分块 union；Edge 使用空间索引，只精确计算 Envelope 相交候选。
- `shade.json.tmp` 通过全量 Schema、Edge coverage 和质量门禁后原子替换正式文件。
- Git 只提交浏览器需要的 `shade.json`、代码、测试和数据来源文档。

## 9. 前端 Shade Layer

前端新增独立 Shade loader、数据验证器、Edge Score 到 GeoJSON 转换器和 Hook。`shade.json` 使用 `assetPath()` 加载，兼容任意 GitHub Pages `BASE_URL`。加载失败只禁用 Shade 控件并显示简洁日语状态，不影响 Road Graph、地图或路线计算。

Shade 默认关闭，用户可选择 `09:00 / 12:00 / 15:00`。切换只重建 Shade GeoJSON 和更新 MapLibre Source，不重新运行 Dijkstra。Z-order 固定为：Heat Exposure、Building Shade、Drinking Station、三条背景路线、Selected Route；Marker 始终在路线之上。

正式日语含义为“建物による推定日陰”，不得表达为实测树荫、实时阴影或温度下降。

## 10. 验收门禁

- Parser：LOD2 完整选择、整栋 LOD1 回退、BuildingPart 聚合、必要 xlink、内环、无效 Z 和 `measuredHeight` 隔离测试通过。
- Solar/Projection：NREL 参考向量、阴影反太阳方向、长度随高度/太阳高度变化、Polygon union/footprint subtraction 测试通过。
- Edge/Publisher：0/1/部分相交、MultiEdge、精确 Edge ID、确定性输出和原子发布测试通过。
- Production：真实 PLATEAU 数据覆盖、质量统计、`shade.json` 全量 Edge 验证通过。
- Frontend：GitHub Pages 路径、默认关闭、三场景切换、错误隔离、Z-order 和不触发 Routing 测试通过。
- 回归：Python tests、`npm test -- --run`、`npm run build`、Pages subpath validation 全部通过；production `graph.json` 未改变。
