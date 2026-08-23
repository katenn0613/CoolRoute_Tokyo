# Tokyo23 数据重建交接说明（谁负责数据管线谁看）

> **本文档用途**：当前线上/本地 `public/data/` 的 Tokyo23
> 数据存在**路网覆盖缺失**问题（见第 3 节），需要数据管线负责人按第 6 节步骤重新跑数据。
> 前端侧代码与构建脚本（`npm run build:route-a`）已就绪，**不需要改前端代码**。
>
> 关联文档：`docs/TOKYO23_SCALE_REPORT_JA.md`（原规模报告）、`docs/TOKYO23_DATA_ISSUES.md`（排查记录）、
> `docs/DATA_SOURCES.md`（数据源清单）、`AGENTS.md`（数据真实性规则，必须遵守）。

## 当前进度（2026-08-22 晚）

- **路网：23/23 区已重新下载并合并**（基线约 254.9 MB，节点/边数远超旧数据；之前缺失的
  台東/北/板橋/荒川/足立/葛飾/練馬北部等全部补齐）。修复：每区 Overpass 下载失败重试 4 次 +
  多实例故障转移（z / lz4 / overpass-api.de）+ 连续 3 区失败自动中止；不再只保留最大弱连通分量。
- **process_green：23 区已完成**（1,206,772 条边，含 green_score / water_penalty）。
- **process_shade：进行中**（672 个 PLATEAU mesh；国内网络对 PLATEAU CDN 偶发 SSL 断连，
  已给 Range 读取加重试 4 次，剩余失败 mesh 可重跑补全）。
- 数据管线工作区在**本机独立目录** `D:\Code\coolroute-data-pipeline`（conda 环境 `coolroute`，
  Python 3.12 + osmnx 2.1.1），与主仓库分离；数据产物先在本地预览（localhost:5174）验证，
  验证通过后按第 6 节复制回主仓库 `public/data/` 并执行 `npm run build:route-a`。

---

## 1. 背景

CoolRoute Tokyo 是一个东京高温步行路线推荐 Demo。2026-08 扩展为东京 23 区（Tokyo23）规模，
数据管线按区（ward）从 OpenStreetMap 下载步行路网，叠加官方绿地/水系/饮水点，再用 PLATEAU
建筑模型计算三时段阴影，最终发布到 `public/data/`（静态托管）。

前端读取的产物：

| 产物 | 文件 | 前端用途 |
|---|---|---|
| 紧凑路网（二进制） | `public/data/graph_tokyo23.bin(.gz)` | Web Worker 路由/吸附（由 `graph_tokyo23.json` 构建） |
| 阴影 | `public/data/shade_tokyo23.json` | 路由加权 + 阴影图层（嵌入二进制图） |
| 热暴露/阴影瓦片 | `public/data/tiles/heat|shade/` | 地图图层（由 graph + shade 构建） |
| 饮水点 | `public/data/drinking_stations_tokyo23.geojson` | 饮水点图层 |

## 2. 症状

地图上只有东京**西部/南中部**区域能渲染出热暴露与阴影图层，以下区域**完全没有**：

- **整区缺失**：台東区、北区、板橋区、荒川区、足立区、葛飾区（路网节点数为 0）
- **大部缺失**：練馬区（仅南部）、大田区（仅北端）、江戸川区（仅西北角）
- **内部空洞**：中央区 東京駅・銀座・日本橋一带；品川区南部稀疏；台東・墨田一带

## 3. 排查结论（证据）

### 3.1 数据状态总表

| 数据 | 状态 | 证据 |
|---|---|---|
| **路网 `graph_tokyo23.json`** | 🔴 **有问题（根因）** | 实际节点范围 `[139.584–139.848] × [35.590–35.736]`，仅为配置 bbox `[139.559–139.918] × [35.528–35.818]` 的约 73% × 50%；南/北/东三带全空；台東/北/板橋/荒川/足立/葛飾 六区节点数 = 0 |
| **热暴露/阴影瓦片 `tiles/`** | ✅ 没问题 | 逐块解码验证：各区域 z10–z13 瓦片均有要素（杉並 z13=920、世田谷 z13=22,732 等）。瓦片由路网生成，路网缺的区域自然无要素 |
| **阴影 `shade_tokyo23.json`** | 🟡 轻微缺 | 672 个 PLATEAU mesh 中 8 个未处理（98.81%）：53393624、53394615/16、53394640–44，集中在中央区东部・江東西部（35.60–35.70°N × 139.75–139.83°E） |
| **饮水点** | 🟡 轻微 | 567 个官方点中 349 个（62%）在路网覆盖范围内，218 个（38%）在覆盖外（路网补齐后自然解决） |
| **green_score** | ⚪ 信息性 | 76.6% 边为 0，符合"15m buffer 内无 300㎡ 树林"定义，疑似正常 |
| **water_penalty** | ⚪ 信息性 | 95.1% 边非零、42.5% > 0.8，需对照公式复核是否正常 |

### 3.2 OSM 源数据不缺（管线丢失的铁证）

2026-08-22 直接查询 OSM Overpass（`lz4.overpass-api.de`，与 `process_road.py` 同一端点）
各区 bbox 内 `highway` way 数量，与发布路网节点数对比：

| 区 | OSM 源 highway ways | 发布路网节点数 | 结论 |
|---|---|---|---|
| 台東区 | 11,685 | **0** | 源有数据，管线丢失 |
| 北区 | 18,172 | **0** | 源有数据，管线丢失 |
| 板橋区 | 13,130 | **0** | 源有数据，管线丢失 |
| 荒川区 | 7,425 | **0** | 源有数据，管线丢失 |
| 足立区 | 19,942 | **0** | 源有数据，管线丢失 |
| 葛飾区 | 25,502 | **0** | 源有数据，管线丢失 |
| 練馬区 | 36,899 | 3,463（仅南部） | 源有数据，管线不完整 |
| 中央区 | 17,716 | 東京駅一带空洞 | 源有数据，管线不完整 |
| 杉並区（对照） | 27,753 | 13,749 | 正常 |
| 世田谷区（对照） | 48,531 | 44,961 | 正常 |

## 4. 根因分析

### 4.1 直接原因：`scripts/tokyo23/process_road.py`

```python
combined = combine_ward_graphs(graph_parts)
largest_nodes = max(nx.weakly_connected_components(combined), key=len)
combined = combined.subgraph(largest_nodes).copy()
```

两个可疑环节：

1. **按 ward 从 Overpass 下载失败会静默丢区**。每个 ward 下载失败只写入
   `data/processed/tokyo23/road_state/failed_ward_report.json`（进度目录在发布后已被删除，
   无法回溯当时哪些区失败）。`run()` 只在最后统一检查"是否有未完成 ward"并抛错——
   若当时所有区被标记完成（或中途某次运行部分失败后又被覆盖），缺失区不会被发现。
2. **最大弱连通分量截断**。都心步行网络若因高架/地下步行道在 OSM 中拓扑不连通
   （`network_type="walk"` 过滤掉车行道后），整个子图会被当孤岛切掉——
   这很可能就是"中央区東京駅・銀座空洞 + 台東/墨田一带空洞"的成因。

### 4.2 直接原因之外：阴影 8 个 mesh 缺失

`scripts/tokyo23/process_shade.py` 按 mesh 增量处理（`shade_state/` 进度），有 8 个 mesh
处理失败/跳过，未重试。

## 5. 需要重跑的数据与文件总览

```
┌──────────────────────────────────────────────────────────────────┐
│ Step 0  环境准备（Python 3.x + requirements-dev.txt，磁盘≥60GB）   │
└──────────────────────────────┬───────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ Step 1  重新下载官方原始数据（data/raw/ 当前为空）                  │
│         python scripts/tokyo23/download_sources.py                │
│         → 绿地 ZIP / 饮水点 CSV / PLATEAU 归档 manifest            │
└──────────────────────────────┬───────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ Step 2  重建路网（根因修复）★                                    │
│         python scripts/tokyo23/process_road.py                   │
│         → data/processed/tokyo23/graph_schema_1_0_baseline.json  │
│         ⚠ 先删 road_state/ 进度；复核连通分量截断逻辑；逐区验收    │
└──────────────────────────────┬───────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ Step 3  环境字段 green/water/饮水点                                │
│         python scripts/tokyo23/process_green.py                   │
│         → public/data/graph_tokyo23.json                         │
│           public/data/environment_metadata_tokyo23.json          │
│           public/data/drinking_stations_tokyo23.geojson          │
└──────────────────────────────┬───────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ Step 4  阴影（补 8 个缺失 mesh）                                   │
│         python scripts/tokyo23/process_shade.py                   │
│         → public/data/shade_tokyo23.json                         │
│         ⚠ 先删 shade_state/ 中失败 mesh 的进度                    │
└──────────────────────────────┬───────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ Step 5  前端产物（npm）★ 前端读取的就是这些                        │
│         npm run build:route-a                                    │
│         → public/data/graph_tokyo23.bin(.gz) + data/tiles/       │
└──────────────────────────────┬───────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ Step 6  校验（验收）                                              │
│         python scripts/tokyo23/validate_tokyo23.py                │
│         → data/processed/tokyo23/validation_report.json          │
└──────────────────────────────────────────────────────────────────┘
```

依赖关系：Step 2 输出是 Step 3 的输入；Step 3 的 `graph_tokyo23.json` 是 Step 4 的输入；
Step 5 同时读取 Step 3 + Step 4 的产物。**顺序不可颠倒，缺步不可发布**。

---

## 6. 分步操作说明

### Step 0 环境准备

- Python 3.10+；`pip install -r requirements-dev.txt`（当前仅 `osmnx==2.1.1`；
  运行期还会用到 geopandas / shapely / networkx / pandas / pyarrow，见 AGENTS.md 允许清单）。
- 磁盘：PLATEAU 归档解压量大，配置 `storageLimitBytes = 53,687,091,200`（50 GB），
  请保证目标盘 ≥60 GB 可用。
- 网络：需要访问 Overpass（`lz4.overpass-api.de`）、東京都开放数据、PLATEAU 归档。

### Step 1 重新下载官方原始数据

`data/raw/` 与 `data/processed/tokyo23/` 当前为空（仅 .gitkeep），原始数据未入库，必须重新获取：

```bash
python scripts/tokyo23/download_sources.py
```

- 下载内容（脚本内 URL 均为官方源）：
  - 绿地：東京都都市整備局 緑のオープンデータ
    `https://data.storage.data.metro.tokyo.lg.jp/toshiseibi/03_jurinchi.zip`（樹林地）、
    `.../10_koukyoushisetsu.zip`（公共施設の緑）等 → `data/raw/green/`
    （catalog: https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d2000000024）
  - 饮水点：東京都水道局 → `data/raw/drinking_station/tokyowaterdrinkingstation_250917.csv`
    （catalog: https://catalog.data.metro.tokyo.lg.jp/dataset/ ...；URL 见
    `scripts/data_sources/drinking_station_source.py`）
  - PLATEAU：建立 `data/processed/tokyo23/plateau_manifest.json`（672 个建筑 mesh 清单，
    归档 URL 见 `config/tokyo23_area.json` / `scripts/data_sources/plateau_source.py`）
- 断点续传：`--force-download` 强制重下；默认跳过已存在的文件。
- **规则**：`data/raw/` 原始文件不得就地修改；禁止用伪造/第三方数据替代（AGENTS.md）。

### Step 2 重建路网（根因修复，最关键）

```bash
# 1) 清掉旧进度，确保 23 区全部重新下载
rm -rf data/processed/tokyo23/road_state
rm -f data/processed/tokyo23/osm_combined.graphml

# 2) 重建
python scripts/tokyo23/process_road.py
```

**重跑前必须修改/确认 `process_road.py` 的以下逻辑**（否则会重蹈覆辙）：

1. **下载失败必须重试/中止，不能静默丢区**。`_download_ward` 失败目前只写
   `failed_ward_report.json`；建议：对每个 ward 失败重试 2–3 次（Overpass 超时常见），
   重试仍失败则**中止整个管线**并报错，而不是继续。
2. **复核最大连通分量截断**。当前 `subgraph(largest_nodes)` 会把"与主分量不连通的
   步行子网"整块切掉（很可能是中央区/台東区空洞的原因）。建议：
   - 先逐区校验下载结果（每区 node/edge 数 > 0，与 OSM way 数量级相符，参考第 3.2 节表）；
   - 再决定是否保留连通分量截断；若要保留，把被切掉的区域与原因写进报告。
3. **Overpass 端点是公共实例**，23 区连续下载容易被限流。建议错峰执行、设置
   `ox.settings.requests_timeout` 与重试；或改用本地 OSM PBF 提取。

**验收**（发布前必须满足，见第 7 节验收表）：23 区每区节点数 > 0；节点 bbox 明显
更接近配置 bbox `[139.559, 35.528, 139.918, 35.818]`。

输出：`data/processed/tokyo23/graph_schema_1_0_baseline.json`。

### Step 3 环境字段（green / water / 饮水点）

```bash
python scripts/tokyo23/process_green.py
```

- 输入：Step 2 的 baseline + Step 1 的 `data/raw/` 官方绿地/饮水点 + `config/tokyo23_area.json`；
- 复用 M4 公式把绿色覆盖比例（15m buffer）与饮水点距离惩罚连接到每条边；
- 输出：`public/data/graph_tokyo23.json`、`environment_metadata_tokyo23.json`、
  `drinking_stations_tokyo23.geojson`；
- 验收：`graph_tokyo23.json` 的 `metadata.edgeCount` 应大于当前 327,240（新边）；每条边
  `green_score`/`water_penalty` 均在 `[0,1]`。

### Step 4 阴影（补 8 个缺失 mesh）

```bash
python scripts/tokyo23/process_shade.py
```

- 输入：Step 3 的 `public/data/graph_tokyo23.json` + Step 1 的 PLATEAU 数据
  （`data/raw/plateau_tokyo23/` + `plateau_manifest.json`）；
- 增量进度在 `data/processed/tokyo23/shade_state/`：重跑前把 8 个失败 mesh
  （53393624、53394615、53394616、53394640、53394641、53394642、53394643、53394644）
  的进度标记删除，或整体删除 `shade_state/` 全量重跑；
- 输出：`public/data/shade_tokyo23.json`；
- 验收：`metadata.quality.missingSourceMeshIds` 为空；`coverageStatus` 为 complete。

### Step 5 前端产物（前端实际读取的文件）

```bash
npm run build:route-a
```

- 内部执行 `scripts/build_binary_graph.mjs`（graph + shade → `graph_tokyo23.bin` / `.bin.gz`）
  与 `scripts/build_route_tiles.mjs`（→ `data/tiles/heat|shade/`）；
- 该步生成的 `.bin.gz`（前端路由用）和瓦片（前端图层用）**必须与新的 JSON 同步**，
  否则前端仍会读到旧数据；
- 验收：`public/data/graph_tokyo23.bin.gz` 大小随新图变化；瓦片 z10–z13 在之前缺失
  区域（台東、足立、葛飾等）出现要素（可用 `docs/TOKYO23_DATA_ISSUES.md` 里的解码方法复核）。

### Step 6 校验

```bash
python scripts/tokyo23/validate_tokyo23.py
```

- 校验 4 个 production 文件的一致性（schema、edge/shade 对齐、饮水点结构）；
- 报告写入 `data/processed/tokyo23/validation_report.json`；
- 建议把第 7 节验收表逐项打勾后再提交 `public/data/`。

---

## 7. 验收标准（发布前逐项确认）

| # | 验收项 | 当前值（问题态） | 目标 |
|---|---|---|---|
| 1 | 台東/北/板橋/荒川/足立/葛飾 六区节点数 | 0 | 均 > 0（参考 OSM ways：11,685/18,172/13,130/7,425/19,942/25,502） |
| 2 | 中央区 東京駅・銀座・日本橋 空洞 | 该格仅 138 条边 | 与周边密度一致（参考 OSM ways 17,716） |
| 3 | 練馬/大田/江戸川 大部缺失 | 3,463 / 1,733 / 1,279 节点 | 覆盖完整（参考 36,899 / … / …） |
| 4 | 节点实际 bbox | `[139.584, 35.590]–[139.848, 35.736]` | 显著更接近 `[139.559, 35.528]–[139.918, 35.818]` |
| 5 | 总节点/边数 | 111,574 / 327,240 | 显著增加（23 区完整） |
| 6 | shade mesh 覆盖 | 98.81%（8 mesh 缺） | 100% 或 missingMeshIds 为空 |
| 7 | 饮水点在路网内比例 | 62% | 接近 100%（路网补齐后自然提升） |
| 8 | `npm run build:route-a` 后瓦片覆盖 | 缺台東/足立/葛飾等 | 各问题区 z10–z13 瓦片有要素 |
| 9 | `validate_tokyo23.py` | — | 通过，报告落盘 |

## 7.5 跨界连通性修复（2026-08-23 新增）

> **问题**：按区（ward）下载并用 osmnx `graph_from_polygon` 合并后，**所有跨区界的边都被删除**。
> osmnx 2.1.1 的 `truncate_graph_polygon` 只删除区多边形外的节点，跨区界的边（桥的过河段等）
> 在相邻两区的图中都会被整条删除，且不保留边界残端；按节点 id 合并后这些真实连接永久丢失。
> 实测：荒川带（lat 35.70–35.80）图内跨河边 **0 条**（OSM 源里该带实有 340 条 bridge way）；
> 23 区路网碎片化成 ~20 个弱连通分量；跨块路由被迫绕全城（如 北区→足立 直线 4.5km、路线 69.9km）。

> **修复**（管线脚本 `D:\Code\coolroute-data-pipeline\scripts\tokyo23\`，产物在本地预览验证）：
>
> 1. **`repair_boundary_gaps.py`**：按 OSM way id 聚合各 ward 图里的边 → 找出被边界切断的同一
>    way 的碎片对 → 恢复碎片间最近节点对（即被删段的两个端点）。`--include-same-component`
>    默认开启（同分量内的真实跨界段也恢复，否则"已通过其它桥可达"的桥会被漏掉导致绕远）。
> 2. **`restore_bridges.py`**：碎片法恢复不了"只出现在单侧区图"的河桥（实测桥 way 往往只在
>    西岸区图里，东岸区图完全没有，如吾妻橋 way 只存在于台東图、墨田图 0 命中）。改用 Overpass
>    查询 `bridge=yes + 可步行 highway` 的桥 way，取两端坐标 → 在图里找两端最近节点并连接。
>    注意：大 bbox 一次查询会被 Overpass 拒连（SSL EOF），需按 3×3 分块查询、块间暂停 10s。
> 3. **`apply_repair_to_graph.py`**：幂等应用（先移除旧 `boundary-gap-` 边再添加）；新边的
>    green/water/shade 用两端点入射边均值回退；同步更新 graph 与 shade JSON 的 edgeCount。
>    ⚠️ 注意：过滤列表/字典后必须重新绑定回 payload（`graph_payload["edges"] = edges`），
>    否则写盘的是旧列表（metadata 与内容数量不一致，实测踩坑）。
> 4. 重建二进制：`app/` 下 `node scripts/build_binary_graph.mjs` → 复制
>    `graph_tokyo23.bin(.gz)` 回主仓库 `public/data/`（tiles 不重跑，背景图层不受影响）。

> **当前状态（2026-08-23 15:30，已完成）**：23 区全量重连完成——碎片修复 937 组候选 + Overpass
> 桥恢复 2,224 组候选 → 应用 6,026 条派生边（135 组节点缺失跳过），edgeCount 1,212,798。
> 结果：弱连通分量由 ~20 个降至 **6 个**（主分量 409,266 节点 / 99.95%，剩 5 个 26–65 节点的
> 真实孤岛碎片，如江東若洲/夢の島、大田羽田南等，OSM 中本无步行桥）；跨区路线全部 1.1–1.4x
> （修复前最坏 69.9km / 15.5x）。产物已同步主仓库 `public/data/graph_tokyo23.bin(.gz)`（本地，
> 未推远端）。

## 8. 常见问题与风险

| 风险 | 说明 | 应对 |
|---|---|---|
| Overpass 公共端点限流/超时 | 23 区连下易失败 | 每区失败重试 2–3 次；失败即中止并报错；错峰执行；或本地 PBF 提取 |
| 最大连通分量切掉都心 | 高架/地下步行道在 OSM 中拓扑断开 → 整区被切 | Step 2 修改逻辑：逐区校验后再截断，被切区域写入报告 |
| PLATEAU 下载/解压大 | 672 mesh，50GB 上限 | 增量 manifest + 断点续传；磁盘 ≥60GB |
| 官方源 URL 变动 | 東京都/PLATEAU URL 可能改版 | URL 集中在 `scripts/data_sources/*.py` 与 `config/tokyo23_area.json`，改版时更新并记录获取日期 |
| 数据真实性 | 禁止伪造/第三方替换 | 严格使用官方源；获取失败必须报告并保留 Loader（AGENTS.md） |
| 前端拿到旧产物 | JSON 更新但 .bin/瓦片没重跑 | 必须执行 Step 5，并核对 Step 7 第 8 项 |

## 9. 数据源清单（附录）

| 数据 | 提供方 | 获取方式 | 许可证 |
|---|---|---|---|
| 步行路网 | OpenStreetMap / Overpass API（`lz4.overpass-api.de`） | `process_road.py` 在线下载 | ODbL |
| 绿地（樹林地等） | 東京都都市整備局 緑のオープンデータ | `download_sources.py` → `data/raw/green/` | 東京都オープンデータ |
| 饮水点 | 東京都水道局 | `download_sources.py` → `data/raw/drinking_station/` | CC BY |
| 建筑模型（阴影） | 国土交通省 Project PLATEAU（東京23区 2020） | `download_sources.py` → `data/raw/plateau_tokyo23/` | PLATEAU Site Policy / CC BY 4.0 |

> 官方 URL、获取日期、空间/时间覆盖、预处理说明的记录位置：
> `docs/DATA_SOURCES.md`、`public/data/environment_metadata_tokyo23.json`、
> `data/processed/tokyo23/validation_report.json`（Step 6 生成）。
