# CoolRoute Tokyo M2 OSM 道路图设计

**状态：** 已批准，包含 2026-08-17 审阅修订。

## 1. 目标与范围

M2 只把当前 Demo Area 内的真实 OpenStreetMap 步行道路网络转换成浏览器可读取的静态 Road Graph：

```text
OpenStreetMap -> OSMnx -> GraphML 真实缓存 -> 验证 -> public/data/graph.json
```

本阶段不处理 Green Data、Drinking Station、Heat Exposure、CoolRoute、Routing、Weather 或 PLATEAU，也不实现任何路径规划算法。

## 2. 唯一 Demo Area 配置

`config/demo_area.json` 是正式的唯一坐标源，包含：

- `id`、`name`、`center`、`zoom`；
- `boundingBox`，顺序固定为 `[west, south, east, north]`，坐标系为 EPSG:4326。

`src/config/demoArea.js` 只导入并冻结该 JSON。Python 通过 `scripts/demo_area.py` 读取并验证同一文件，不设置另一套坐标默认值。

## 3. 真实 OSM Source Layer

继续扩展 `scripts/data_sources/osm_source.py`，不创建第二套 downloader。

- 使用 OSMnx `graph_from_bbox` 和 `network_type="walk"`；
- 传入显式转换后的 `(west, south, east, north)`；
- 使用 `simplify=True`、`retain_all=False`；
- 默认从 `data/raw/osm/osm_walking.graphml` 加载；
- 缓存不存在或显式使用 `--force-download` 时才访问 Overpass；
- 下载成功后保存 GraphML 和 `osm_walking.metadata.json` 来源 sidecar；
- 网络失败且没有缓存时明确失败，不生成 production Graph；
- `retain_all=False` 后若图仍非弱连通，只报告并停止，不删除组件或修改真实道路图。

来源 metadata 记录发布方、来源、许可证、获取时间、Demo Area、空间覆盖、时间覆盖语义、OSMnx 版本、网络类型和预处理说明。`data/raw/` 文件不就地修改；强制下载时先在内存获取成功，再覆盖缓存。

## 4. 浏览器 Graph Schema 1.0.0

`public/data/graph.json` 顶层包含 `metadata`、`nodes` 和 `edges`。

`metadata.graphVersion` 表示 **浏览器 Graph Schema Version**，不是 OpenStreetMap 数据版本。M2 使用 `1.0.0`；未来 M4 若增加 `green_score`、`water_penalty` 等 Edge 字段，应按兼容性升级，例如 `1.1.0`。

Node 以字符串 ID 为对象键，并至少包含：

```json
{"id": "123", "lat": 35.68, "lon": 139.75}
```

每条 MultiDiGraph 有向 Edge 都独立输出，不合并平行边：

```json
{
  "id": "u:v:key",
  "source": "u",
  "target": "v",
  "length": 42.5,
  "geometry": [[139.75, 35.68], [139.751, 35.681]]
}
```

Edge geometry 从 Shapely LineString 转为 `[lon, lat]`。若真实 OSM Edge 缺少 geometry，才使用 source/target 坐标。转换器比较 geometry 两端与 source/target 的距离，必要时反转，使坐标顺序与 `source -> target` 一致。

## 5. 验证规则

统一验证既用于真实 GraphML，也用于导出前的浏览器 Graph：

1. Node 和 Edge 数量均大于 0；
2. 图坐标系是地理坐标 EPSG:4326；
3. 所有 Node 经纬度为有限合法值；
4. 所有 Edge source/target 均存在；
5. length 为有限正数；
6. geometry 至少包含两个合法坐标，并与有向端点一致；
7. `nx.is_weakly_connected(G)` 为真，否则停止且不修改图；
8. 至少 90% Node 位于 Demo bounding box 内；
9. 图的节点范围中心位于 Demo bounding box 内；
10. 不允许 Node 超出 Demo bounding box 任何一侧超过 `0.01` 度；该规则容许边界拓扑节点，但拒绝明显远点。

Start / Destination 后续仍必须严格限制在原始 Demo bounding box 内；该 UI 规则不因道路图边界容差而放宽。

验证输出 Node 数、Edge 数、平均 Edge Length、最大 Edge Length、实际节点范围和文件大小。

## 6. 原子输出与失败行为

`graph.json` 先写入目标目录中的临时文件，序列化和验证成功后再原子替换正式文件，避免失败时留下半成品。

- 没有网络且没有真实缓存：退出，不创建 synthetic production Graph；
- 缓存损坏或验证失败：报告原因，不自动重新解释、删边或删节点；
- JSON 转换失败：不更新 Registry；
- 只有真实 GraphML 成功获取或加载、验证通过、`graph.json` 成功导出后，OSM 状态才可改为 `ready`。

Synthetic MultiDiGraph 只存在于 `tests/` 的临时目录，不写入 `data/raw/`、`data/processed/` 或 `public/data/`。

## 7. 测试与验收

Python 测试覆盖：

- 共享 Demo Area 解析和顺序；
- 缓存优先与 `force_download` 分支；
- 无缓存下载失败不会产生文件；
- MultiDiGraph 平行有向 Edge 保留；
- geometry 方向纠正及缺失 geometry 回退；
- 非弱连通、非法端点、非法长度、异常远点等失败；
- Graph Schema metadata 与原子 JSON 输出。

最终验收执行 Python 预处理、Python 全部测试、`npm test -- --run`、`npm run build`，并确认 M1 前端未受破坏。
