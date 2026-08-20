# CoolRoute Tokyo M10 Building Shade 实施计划

> **供执行代理使用：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务执行。步骤用复选框（`- [ ]`）跟踪。

**目标：** 从 Project PLATEAU 官方 LOD Geometry 离线生成当前 Demo Area 在秋分日 09:00、12:00、15:00 的 Edge Shade Score，原子发布独立 `shade.json`，并以不影响 Routing 的 MapLibre 图层展示。

**架构：** Python 流水线分为 A CityGML/Geometry、B Solar/Shadow、C Edge Score/Publisher；浏览器 D 通过独立 loader/hook 把 Sidecar Score 与现有 Road Graph Geometry 合并。LOD2 必须整栋完整，否则整栋回退 LOD1；所有失败保持与 production graph 和三路线计算隔离。

**技术栈：** Python 3.12 标准库 XML/HTTP/数学、GeoPandas、Shapely、Pandas；React 19、Vite 8、JavaScript、MapLibre GL JS、Vitest。

**规格：** `docs/superpowers/specs/2026-08-21-m10-building-shade-design.md`

## 全局约束

- Building Height 仅为所选 PLATEAU LOD Geometry 的 `max(Z)-min(Z)`；`measuredHeight` 只用于 QA。
- 完整 LOD2 优先，否则整栋完整 LOD1；禁止混合 LOD，禁止属性高度或模拟高度回退。
- 第一版仅支持当前官方数据必要的内联 Geometry 和 Building 内 `xlink` 路径。
- `shade.json` 独立发布；不得修改 `graph.json`、Graph Schema 1.1.0、Road topology、Routing、Heat Exposure Formula、Green/Water。
- 固定 `2026-09-23`、`Asia/Tokyo`、09:00/12:00/15:00；不用 Weather。
- `generatedAt` 只作溯源，不参与分数、缓存键、排序、快照或确定性比较。
- Raw CityGML 不提交 Git；synthetic CityGML 只能进入 tests。
- 每个任务完成后先定向验证；A、B、C、D 四段分别形成可审查检查点。

## 文件结构

- `scripts/data_sources/plateau_source.py`：官方资源清单、目标网格选择、Raw 缓存和增量 ZIP Entry 获取。
- `scripts/shade/config.py`：固定日期、场景、CRS、LOD 和输出路径。
- `scripts/shade/citygml.py`：流式 CityGML 与必要 xlink 解析。
- `scripts/shade/geometry.py`：LOD 完整性、BuildingPart 聚合、Z Range 和 CRS 转换。
- `scripts/shade/solar.py`：确定性 Meeus/NOAA 太阳几何接口（采用 NREL SPA 方位角约定）。
- `scripts/shade/projection.py`：三维表面投影、union 和建筑 Footprint 扣除。
- `scripts/shade/edge_scores.py`：Road Edge 与阴影相交长度比例。
- `scripts/shade/publisher.py`：Sidecar schema、确定性序列化、验证和原子发布。
- `scripts/build_shade_data.py`：A→B→C 正式 CLI 编排，不包含几何算法。
- `src/shade/shadeLoader.js`：GitHub Pages 兼容加载与 schema/Edge ID 验证。
- `src/shade/shadeLayer.js`：正式 Road Geometry 与某场景 Shade Score 转 GeoJSON。
- `src/shade/useShadeLayer.js`：独立加载、选择场景和错误隔离状态。
- `src/config/shadeConfig.js`：前端三场景和日语文案。
- `public/data/shade.json`：唯一 production Browser Shade 数据。

---

## A. CityGML 解析与 Geometry 验证

### 任务 1：锁定 M10 配置与官方 PLATEAU Source 契约

**文件：**

- 创建：`scripts/shade/__init__.py`
- 创建：`scripts/shade/config.py`
- 创建：`scripts/data_sources/plateau_source.py`
- 创建：`tests/python/test_plateau_source.py`
- 修改：`.gitignore`

**接口：**

- `ShadeConfig(reference_date, timezone, scenarios, analysis_crs, graph_path, output_path)`
- `PlateauSource.plan_entries(graph_bounds) -> tuple[PlateauEntry, ...]`
- `PlateauSource.fetch_entries(entries, force_download=False) -> tuple[Path, ...]`

- [ ] **步骤 1：写 Source 和固定配置失败测试**

```python
def test_shade_config_is_fixed_and_deterministic():
    config = default_shade_config()
    assert config.reference_date.isoformat() == "2026-09-23"
    assert config.scenarios == ("09:00", "12:00", "15:00")
    assert config.analysis_crs == "EPSG:6677"

def test_plateau_source_only_plans_required_building_entries(fake_manifest):
    planned = PlateauSource(fake_manifest).plan_entries((139.744, 35.672, 139.771, 35.694))
    assert planned
    assert all(entry.path.endswith("_bldg_6697_op.gml") for entry in planned)
    assert all(entry.dataset_id == "plateau-13101-chiyoda-ku-2023" for entry in planned)
```

- [ ] **步骤 2：确认测试为 RED**

运行：`.venv/bin/python -m unittest tests.python.test_plateau_source -v`  
预期：因 `scripts.shade.config` 和 `plateau_source` 不存在而失败。

- [ ] **步骤 3：实现集中配置、官方资源记录和原子 Raw 缓存**

配置必须直接编码已批准的固定场景；Source 下载只写 `.part`，成功后 `Path.replace()`，缓存记录 URL、ETag、Last-Modified、byte size 和 entry path。`.gitignore` 保持 `data/raw/**` 排除，并增加 `data/processed/shade/**` 的说明性注释，不改变现有规则。

- [ ] **步骤 4：验证缓存命中、强制下载和失败不破坏旧 Raw**

运行：`.venv/bin/python -m unittest tests.python.test_plateau_source -v`  
预期：全部 PASS，测试使用本地 fake HTTP/fixture，不访问网络。

- [ ] **步骤 5：提交 A1 检查点**

```bash
git add .gitignore scripts/shade scripts/data_sources/plateau_source.py tests/python/test_plateau_source.py
git commit -m "feat: add PLATEAU shade source contract"
```

### 任务 2：流式 CityGML Parser 与必要 xlink

**文件：**

- 创建：`scripts/shade/citygml.py`
- 创建：`tests/python/fixtures/plateau_buildings.gml`
- 创建：`tests/python/test_shade_citygml.py`

**接口：**

- `iter_buildings(path: Path) -> Iterator[ParsedBuilding]`
- `ParsedBuilding(id, measured_height, lod1, lod2, parts, source_crs, quality_flags)`
- `ParsedSolid(surfaces, referenced_surface_ids, unresolved_reference_ids)`

- [ ] **步骤 1：建立最小 synthetic CityGML fixture**

Fixture 必须包含四栋明确标记 synthetic 的建筑：完整内联 LOD2、Building 内 `xlink` LOD2、多 BuildingPart LOD2、LOD2 引用缺失但 LOD1 完整；其中一个 `measuredHeight=-9999`，并至少有一个 Polygon interior ring。

- [ ] **步骤 2：写 Parser RED 测试**

```python
def test_parser_resolves_required_building_local_xlinks():
    buildings = {item.id: item for item in iter_buildings(FIXTURE)}
    assert buildings["synthetic-xlink"].lod2.unresolved_reference_ids == ()
    assert len(buildings["synthetic-xlink"].lod2.surfaces) == 6

def test_parser_preserves_parts_z_and_polygon_holes():
    building = next(item for item in iter_buildings(FIXTURE) if item.id == "synthetic-parts")
    assert len(building.parts) == 2
    assert any(surface.interior_rings for part in building.parts for surface in part.lod2.surfaces)
```

- [ ] **步骤 3：运行 RED**

运行：`.venv/bin/python -m unittest tests.python.test_shade_citygml -v`  
预期：`iter_buildings` 未实现而失败。

- [ ] **步骤 4：实现 `iterparse` 和 Building 子树内 ID 索引**

实现只解析规格列出的必要元素；`posList` 按 `srsDimension=3` 分组；保留 exterior/interior；在 Building 完成事件内解析 `#gml-id`。跨 Building、跨文件或 URI 引用写入 `unresolved_reference_ids`，不建设通用引用抓取器。

- [ ] **步骤 5：运行 Parser 测试**

运行：`.venv/bin/python -m unittest tests.python.test_shade_citygml -v`  
预期：全部 PASS，并通过计数断言证明元素处理后被释放。

- [ ] **步骤 6：提交 A2 检查点**

```bash
git add scripts/shade/citygml.py tests/python/fixtures/plateau_buildings.gml tests/python/test_shade_citygml.py
git commit -m "feat: parse required PLATEAU building geometry"
```

### 任务 3：整栋 LOD 选择、Z Range 和 Geometry Validation

**文件：**

- 创建：`scripts/shade/geometry.py`
- 创建：`tests/python/test_shade_geometry.py`

**接口：**

- `select_building_geometry(parsed: ParsedBuilding) -> SelectedBuildingGeometry`
- `SelectedBuildingGeometry(building_id, selected_lod, solids, min_z, max_z, height, footprint, quality_flags)`
- `validate_geometry_coverage(buildings, road_bounds, solar_positions) -> CoverageReport`

- [ ] **步骤 1：写 LOD 和 Height RED 测试**

```python
def test_complete_lod2_wins_and_height_uses_all_parts():
    selected = select_building_geometry(parsed_parts_building())
    assert selected.selected_lod == 2
    assert selected.min_z == 10.0
    assert selected.max_z == 42.0
    assert selected.height == 32.0

def test_incomplete_lod2_falls_back_whole_building_to_lod1():
    selected = select_building_geometry(parsed_incomplete_lod2())
    assert selected.selected_lod == 1
    assert all(solid.lod == 1 for solid in selected.solids)

def test_measured_height_never_changes_selected_geometry():
    first = select_building_geometry(parsed_with_measured_height(-9999))
    second = select_building_geometry(parsed_with_measured_height(999))
    assert first.deterministic_geometry() == second.deterministic_geometry()
```

- [ ] **步骤 2：运行 RED**

运行：`.venv/bin/python -m unittest tests.python.test_shade_geometry -v`  
预期：选择器不存在而失败。

- [ ] **步骤 3：实现完整性规则与 EPSG:6677 转换**

有效 Ring 要求有限 XYZ、至少三个不同 XY 点并闭合；整栋/全部 Part 的选定 LOD 必须完整。Height 聚合选定 LOD 全部有效 Z。`measuredHeight` 只复制到 QA 字段并计算可选差值，不进入任何分支条件。

- [ ] **步骤 4：实现影响范围迭代验证**

以 Road Graph Geometry Envelope、最低太阳高度和当前 Geometry 最大投影长度验证 source coverage。覆盖不足返回所需相邻 Mesh，不用固定建筑高度；影响区内无有效 LOD 的建筑使报告失败。

- [ ] **步骤 5：运行 Geometry 测试**

运行：`.venv/bin/python -m unittest tests.python.test_shade_geometry -v`  
预期：完整 LOD2、整栋 LOD1、无混合、Z Range、无效 Z、覆盖扩展测试全部 PASS。

- [ ] **步骤 6：运行一次真实 A 段审计**

运行：`.venv/bin/python scripts/build_shade_data.py --stage geometry --no-publish`（任务 8 CLI 完成前，使用等价模块入口）。  
验收：记录目标 Mesh、Building 数、LOD2 数、LOD1 fallback 数、无效数、Height min/median/max、必要 xlink 未解析数；若影响区内无效或未解析引用大于 0，停止 B–D，不发布数据。

- [ ] **步骤 7：提交 A3 检查点**

```bash
git add scripts/shade/geometry.py tests/python/test_shade_geometry.py
git commit -m "feat: validate PLATEAU LOD geometry heights"
```

---

## B. Solar Position 与 Shadow Projection

### 任务 4：确定性太阳位置模型

**文件：**

- 创建：`scripts/shade/solar.py`
- 创建：`tests/python/test_shade_solar.py`

**接口：**

- `solar_position(instant: datetime, latitude: float, longitude: float) -> SolarPosition`
- `build_solar_scenarios(config, center) -> dict[str, SolarPosition]`
- `SolarPosition(azimuth_degrees, elevation_degrees)`

- [x] **步骤 1：写 NREL 参考与固定场景 RED 测试**

```python
def test_spa_matches_published_reference_case():
    position = solar_position(NREL_REFERENCE_INSTANT, 39.742476, -105.1786)
    assert position.azimuth_degrees == approx(NREL_REFERENCE_AZIMUTH, abs=0.1)
    assert position.elevation_degrees == approx(NREL_REFERENCE_ELEVATION, abs=0.1)

def test_m10_scenarios_are_repeatable():
    assert build_solar_scenarios(CONFIG, DEMO_CENTER) == build_solar_scenarios(CONFIG, DEMO_CENTER)
```

测试常量从 NREL TP-560-34302 的公开 reference case 逐值抄录，并在测试注释记录页码；不从网络动态获取预期值。

- [x] **步骤 2：运行 RED**

运行：`.venv/bin/python -m unittest tests.python.test_shade_solar -v`  
预期：太阳模块不存在而失败。

- [x] **步骤 3：实现公开的确定性太阳几何数学步骤**

只使用标准库 `datetime`、`math` 和 `zoneinfo`；返回从正北顺时针方位角和未经折射修正的几何高度角。不得读取系统当前时间、天气或远程 API。由于 NREL 官方 C 源码的再分发许可不适合公开仓库，正式实现使用 Meeus/NOAA 公式并以 NREL 公开参考案例在 0.1 度内验收，不冒充官方 C 版本。

- [x] **步骤 4：验证固定场景**

运行：`.venv/bin/python -m unittest tests.python.test_shade_solar -v`  
预期：NREL reference 0.1 度 tolerance 和 09/12/15 三场景顺序/高度大于零全部 PASS。

- [ ] **步骤 5：提交 B1 检查点**

```bash
git add scripts/shade/solar.py tests/python/test_shade_solar.py
git commit -m "feat: add deterministic shade solar scenarios"
```

### 任务 5：三维表面投影、Shadow union 与 Footprint 扣除

**文件：**

- 创建：`scripts/shade/projection.py`
- 创建：`tests/python/test_shade_projection.py`

**接口：**

- `project_vertex(x, y, z, ground_z, solar) -> tuple[float, float]`
- `project_building_shadow(building, solar) -> BaseGeometry`
- `build_shadow_union(buildings, solar, tile_size_m=500) -> BaseGeometry`

- [ ] **步骤 1：写投影公式 RED 测试**

```python
def test_ten_meter_vertex_at_45_degrees_casts_ten_meter_shadow():
    point = project_vertex(0, 0, 10, 0, SolarPosition(90, 45))
    assert point == approx((-10, 0), abs=1e-9)

def test_shadow_points_opposite_sun_and_excludes_footprint():
    shadow = project_building_shadow(rectangular_prism(), SolarPosition(135, 45))
    assert shadow.is_valid
    assert shadow.intersection(rectangular_prism().footprint).area == approx(0, abs=1e-8)
```

- [ ] **步骤 2：运行 RED**

运行：`.venv/bin/python -m unittest tests.python.test_shade_projection -v`  
预期：projection 模块不存在而失败。

- [ ] **步骤 3：实现 per-Solid local ground 和表面投影**

GroundSurface 有效时取其最低 Z；LOD1/无 GroundSurface Solid 取该 Solid 最低 Z。投影全部外部面，修复只允许 `make_valid` 后维度仍为 Polygon/MultiPolygon 且面积变化在明确容差内。

- [ ] **步骤 4：实现分块 union 和全部建筑 Footprint 扣除**

按 500m analysis tile 分组候选，局部 `unary_union` 后再合并相邻结果；最后统一 `difference(all_building_footprints)`，避免建筑之间重叠阴影重复计算。

- [ ] **步骤 5：运行 Projection 测试**

运行：`.venv/bin/python -m unittest tests.python.test_shade_projection -v`  
预期：方向、长度、不同 Part 地面、重叠 union、Footprint 扣除和无效修复测试全部 PASS。

- [ ] **步骤 6：真实 B 段抽查**

对至少 5 栋真实 LOD2 和 5 栋真实 LOD1 fallback 输出临时 QA GeoPackage，检查 09:00/12:00/15:00 阴影方向、Polygon validity 和面积分布。QA 文件留在 ignored `data/processed/shade/`，不得进入 public。

- [ ] **步骤 7：提交 B2 检查点**

```bash
git add scripts/shade/projection.py tests/python/test_shade_projection.py
git commit -m "feat: project PLATEAU building shadows"
```

---

## C. Edge Shade Score 与 `shade.json`

### 任务 6：Edge 中心线 Shade Score

**文件：**

- 创建：`scripts/shade/edge_scores.py`
- 创建：`tests/python/test_shade_edge_scores.py`

**接口：**

- `load_graph_edges(path, analysis_crs) -> tuple[ProjectedEdge, ...]`
- `calculate_edge_shade_scores(edges, shadows_by_scenario) -> dict[str, tuple[float, float, float]]`
- `ProjectedEdge(id, source, target, geometry, projected_length)`

- [ ] **步骤 1：写 0/1/部分相交和 MultiEdge RED 测试**

```python
def test_edge_shade_fraction_uses_projected_geometry_length():
    scores = calculate_edge_shade_scores(
        [edge("a:b:0", [(0, 0), (10, 0)])],
        {"09:00": box(0, -1, 4, 1), "12:00": box(-1, -1, 11, 1), "15:00": Polygon()},
    )
    assert scores["a:b:0"] == approx((0.4, 1.0, 0.0))

def test_parallel_edges_keep_distinct_ids():
    scores = calculate_edge_shade_scores(parallel_edges(), three_empty_scenarios())
    assert set(scores) == {"a:b:0", "a:b:1"}
```

- [ ] **步骤 2：运行 RED**

运行：`.venv/bin/python -m unittest tests.python.test_shade_edge_scores -v`  
预期：edge_scores 模块不存在而失败。

- [ ] **步骤 3：实现 Graph Geometry 投影和 STRtree 候选相交**

从 production `graph.json` 读取每条 Edge Geometry，转换 EPSG:6677；Score 分母使用投影 Geometry length，不写回 `edge.length`。阴影为空时显式返回 0，所有结果先验证有限和容差再限制到 `[0,1]`。

- [ ] **步骤 4：运行 Edge 测试**

运行：`.venv/bin/python -m unittest tests.python.test_shade_edge_scores -v`  
预期：0/1/partial、折线、平行 Edge、零长度拒绝测试全部 PASS。

- [ ] **步骤 5：提交 C1 检查点**

```bash
git add scripts/shade/edge_scores.py tests/python/test_shade_edge_scores.py
git commit -m "feat: calculate road edge shade scores"
```

### 任务 7：确定性 Sidecar Serializer 与原子 Publisher

**文件：**

- 创建：`scripts/shade/publisher.py`
- 创建：`tests/python/test_shade_publisher.py`

**接口：**

- `build_shade_payload(graph_metadata, source_metadata, solar_positions, quality, scores, generated_at) -> dict`
- `deterministic_payload(payload) -> dict`
- `validate_shade_payload(payload, graph_payload) -> ShadeValidationReport`
- `publish_shade_json(payload, destination) -> None`

- [ ] **步骤 1：写 Schema、确定性和原子写入 RED 测试**

```python
def test_generated_at_does_not_change_deterministic_result():
    first = build_payload(generated_at="2026-08-21T00:00:00Z")
    second = build_payload(generated_at="2026-08-22T00:00:00Z")
    assert deterministic_payload(first) == deterministic_payload(second)

def test_every_graph_edge_occurs_exactly_once():
    report = validate_shade_payload(valid_payload(), graph_fixture())
    assert report.missing_edge_ids == ()
    assert report.unknown_edge_ids == ()
```

- [ ] **步骤 2：运行 RED**

运行：`.venv/bin/python -m unittest tests.python.test_shade_publisher -v`  
预期：publisher 模块不存在而失败。

- [ ] **步骤 3：实现固定字段顺序和四位小数序列化**

Edge key 按 production graph 原始 Edge 顺序输出；三场景数组顺序来自固定 config。`generatedAt` 保留在 metadata，但 `deterministic_payload()` 删除它后用于回归比较和缓存判断。

- [ ] **步骤 4：实现全量验证和临时文件替换**

验证 schema 1.0.0、Graph Schema 1.1.0、场景、每个 Edge ID、三值数组和数值范围。先写同目录 `.tmp`、重新读取验证，再 `Path.replace()`；任何异常删除临时文件且不触碰旧 production。

- [ ] **步骤 5：运行 Publisher 测试**

运行：`.venv/bin/python -m unittest tests.python.test_shade_publisher -v`  
预期：缺失/未知/重复 Edge、NaN/Inf/越界、generatedAt 隔离、写入中断测试全部 PASS。

- [ ] **步骤 6：提交 C2 检查点**

```bash
git add scripts/shade/publisher.py tests/python/test_shade_publisher.py
git commit -m "feat: publish deterministic shade sidecar data"
```

### 任务 8：正式 CLI、真实数据构建和 Production Validation

**文件：**

- 创建：`scripts/build_shade_data.py`
- 创建：`tests/python/test_shade_pipeline.py`
- 创建：`tests/python/test_shade_production.py`
- 生成：`public/data/shade.json`

**接口：**

- CLI：`python scripts/build_shade_data.py [--stage geometry|shadow|publish] [--force-download] [--no-publish]`
- `run_pipeline(config, source, graph_path, publish) -> ShadeBuildReport`

- [ ] **步骤 1：写 synthetic 端到端 RED 测试**

```python
def test_pipeline_builds_three_scores_without_mutating_graph(tmp_path):
    before = json.loads(GRAPH_FIXTURE.read_text())
    report = run_pipeline(synthetic_config(tmp_path), fixture_source(), GRAPH_FIXTURE, publish=True)
    after = json.loads(GRAPH_FIXTURE.read_text())
    assert before == after
    assert report.edge_count == len(before["edges"])
    assert report.scenarios == ("09:00", "12:00", "15:00")
```

- [ ] **步骤 2：运行 RED**

运行：`.venv/bin/python -m unittest tests.python.test_shade_pipeline -v`  
预期：CLI 编排不存在而失败。

- [ ] **步骤 3：实现薄 CLI 编排和阶段检查点**

CLI 只调用前面模块；每阶段写 machine-readable report 到 ignored `data/processed/shade/reports/`。`--no-publish` 禁止触碰 public；A 验证失败不得执行 B，B 失败不得执行 C。

- [ ] **步骤 4：跑 synthetic 端到端测试**

运行：`.venv/bin/python -m unittest tests.python.test_shade_pipeline -v`  
预期：Graph 深比较不变、三场景、确定性重跑和失败隔离全部 PASS。

- [ ] **步骤 5：执行真实 A→B→C 流水线**

运行：`.venv/bin/python scripts/build_shade_data.py --stage publish`  
预期：仅获取所需官方 Mesh；A/B/C 门禁通过；原子生成 `public/data/shade.json`。网络或真实 Geometry 阻塞时明确停止，不用 synthetic production。

- [ ] **步骤 6：执行 Production Validation**

运行：`.venv/bin/python -m unittest tests.python.test_shade_production -v`  
验收：官方 source metadata、LOD 质量统计、16,046 个正式 Edge 全覆盖、三值 `[0,1]`、Graph 文件深比较与 M10 前基线相同、两次构建的 `deterministic_payload` 相同。

- [ ] **步骤 7：报告真实数据统计**

输出 LOD2/LOD1 fallback/invalid 数、Geometry Height min/median/max、三个场景太阳位置、Shadow 总面积、Shade Score min/mean/median/max/std/零值/满值占比、`shade.json` 文件大小和流水线各阶段耗时。

- [ ] **步骤 8：提交 C3 检查点**

```bash
git add scripts/build_shade_data.py tests/python/test_shade_pipeline.py tests/python/test_shade_production.py public/data/shade.json
git commit -m "feat: generate production building shade data"
```

---

## D. 前端 Shade Layer

### 任务 9：Shade loader、Graph Join 和独立 Hook

**文件：**

- 创建：`src/config/shadeConfig.js`
- 创建：`src/shade/shadeLoader.js`
- 创建：`src/shade/shadeLayer.js`
- 创建：`src/shade/useShadeLayer.js`
- 创建：`tests/javascript/shadeLoader.test.js`
- 创建：`tests/javascript/shadeLayer.test.js`
- 创建：`tests/javascript/useShadeLayer.test.jsx`

**接口：**

- `loadShadeData({ fetchImpl, url } = {}) -> Promise<ShadePayload>`
- `validateShadePayload(payload, graph) -> ShadePayload`
- `buildShadeFeatureCollection(graph, payload, scenario) -> FeatureCollection`
- `useShadeLayer({ graph, loadShade } = {}) -> { status, error, scenario, setScenario, geoJSON }`

- [ ] **步骤 1：写 GitHub Pages 路径和 Schema RED 测试**

```javascript
it('loads shade.json through BASE_URL and validates exact graph edges', async () => {
  const payload = await loadShadeData({ fetchImpl, url: '/repo/data/shade.json' })
  expect(fetchImpl).toHaveBeenCalledWith('/repo/data/shade.json')
  expect(validateShadePayload(payload, graph)).toBe(payload)
})
```

- [ ] **步骤 2：写场景 Join 和 Hook 隔离 RED 测试**

```javascript
it('changes shade scenario without invoking routing', () => {
  const { result } = renderHook(() => useShadeLayer({ graph, loadShade }))
  act(() => result.current.setScenario('15:00'))
  expect(result.current.geoJSON.features[0].properties.shadeScore).toBe(0.8)
  expect(calculateRouteBundle).not.toHaveBeenCalled()
})
```

- [ ] **步骤 3：运行 RED**

运行：`npm test -- --run tests/javascript/shadeLoader.test.js tests/javascript/shadeLayer.test.js tests/javascript/useShadeLayer.test.jsx`  
预期：三个模块不存在而失败。

- [ ] **步骤 4：实现 loader、严格验证和 Geometry Join**

默认 URL 使用 `assetPath('data/shade.json')`；验证 Sidecar schema、固定 scenarios、Graph metadata、Edge ID 全覆盖。GeoJSON 复用 `graph.edges` 的正式 Geometry，只加入 `edgeId`、`shadeScore`、`scenario` properties。

- [ ] **步骤 5：实现独立 Hook**

Graph 未 ready 时状态为 idle；Graph ready 后一次加载 Sidecar。默认 12:00；切换场景只重建 FeatureCollection。加载失败设 error 状态但不修改 Graph、Route Bundle 或用户选择。

- [ ] **步骤 6：运行定向 JS 测试**

运行：`npm test -- --run tests/javascript/shadeLoader.test.js tests/javascript/shadeLayer.test.js tests/javascript/useShadeLayer.test.jsx`  
预期：合法加载、缺失 Edge、未知 Edge、越界 Score、三场景切换、取消加载和错误隔离全部 PASS。

- [ ] **步骤 7：提交 D1 检查点**

```bash
git add src/config/shadeConfig.js src/shade tests/javascript/shadeLoader.test.js tests/javascript/shadeLayer.test.js tests/javascript/useShadeLayer.test.jsx
git commit -m "feat: load browser building shade data"
```

### 任务 10：MapLibre Shade Layer 与日语控件

**文件：**

- 修改：`src/App.jsx`
- 修改：`src/components/MapView.jsx`
- 修改：`src/components/MapLayerControls.jsx`
- 修改：`src/config/presentationConfig.js`
- 修改：`src/styles.css`
- 修改：`tests/javascript/App.test.jsx`
- 修改：`tests/javascript/MapView.test.jsx`

**接口：**

- `MapView` 新增 `shadeGeoJSON`、`shadeStatus`、`shadeScenario`、`onShadeScenarioChange` props。
- Z-order：`heat-exposure-line` → `building-shade-line` → `drinking-stations-points` → background routes → selected route。

- [ ] **步骤 1：写默认关闭、三场景和 Z-order RED 测试**

```javascript
expect(maplibre.addLayer.mock.calls.map(([layer]) => layer.id)).toEqual([
  'heat-exposure-line', 'building-shade-line', 'drinking-stations-points',
  'route-fastest-line', 'route-balanced-line', 'route-coolest-line', 'route-selected-line',
])
expect(screen.getByLabelText('建物による推定日陰')).not.toBeChecked()
fireEvent.change(screen.getByLabelText('日陰条件'), { target: { value: '15:00' } })
expect(onShadeScenarioChange).toHaveBeenCalledWith('15:00')
```

- [ ] **步骤 2：运行 RED**

运行：`npm test -- --run tests/javascript/MapView.test.jsx tests/javascript/App.test.jsx`  
预期：Shade props、图层和控件不存在而失败。

- [ ] **步骤 3：接入 Hook 和 MapLibre Source/Layer**

`App` 用 `routingState.roadGraph` 调用 `useShadeLayer`；Map source 使用传入 GeoJSON。Shade 图层默认 `visibility:none`，颜色固定为冷灰蓝，透明度按 `shadeScore` 插值；路线和 Marker 顺序不变。

- [ ] **步骤 4：实现日语状态与错误隔离**

控件文案为 `建物による推定日陰` 和 `日陰条件`；选择项为 `09:00 / 12:00 / 15:00`。加载中禁用复选框；失败显示 `日陰データを利用できません`，但地图、给水点、Heat Layer 和路线控件继续可用。

- [ ] **步骤 5：运行 UI 定向测试**

运行：`npm test -- --run tests/javascript/MapView.test.jsx tests/javascript/App.test.jsx`  
预期：默认关闭、场景切换只 setData、Z-order、selected route 顶层、错误隔离和日语文案全部 PASS。

- [ ] **步骤 6：提交 D2 检查点**

```bash
git add src/App.jsx src/components/MapView.jsx src/components/MapLayerControls.jsx src/config/presentationConfig.js src/styles.css tests/javascript/App.test.jsx tests/javascript/MapView.test.jsx
git commit -m "feat: display building shade scenarios"
```

### 任务 11：数据登记、全量回归、Build 和 M10 验收

**文件：**

- 修改：`docs/DATA_SOURCES.md`
- 修改：`docs/METHODOLOGY.md`
- 修改：`docs/PROJECT_OVERVIEW_JA.md`
- 修改：`README.md`
- 修改：`src/config/dataSources.js`
- 修改：`docs/superpowers/plans/2026-08-21-m10-building-shade.md`

- [ ] **步骤 1：只在真实 `shade.json` 发布成功后更新 Registry**

PLATEAU 状态从 `not_started` 更新为 `ready`；记录数据集 ID、官方 URL、License、LOD 策略、Geometry Z Range、固定场景、Raw/Processed/Public 路径和质量统计。若 production 构建失败，保持非 ready。

- [ ] **步骤 2：写日语方法说明**

统一使用 `建物による推定日陰`，说明这是固定秋分日、道路中心线、PLATEAU Geometry 的模型结果，不是实时阴影、树荫、道路温度或医疗风险。明确 Shade 尚未进入 Routing Cost。

- [ ] **步骤 3：运行 Python 全量测试**

运行：`.venv/bin/python -m unittest discover -s tests/python -v`  
预期：全部 PASS，包括 production Shade validation 和原有 M2/M4 validation。

- [ ] **步骤 4：运行 JavaScript 全量测试**

运行：`npm test -- --run`  
预期：全部 PASS；M3/M4/M5/M6/M7/M8 回归不变，切换 Shade 不调用 Route Bundle。

- [ ] **步骤 5：运行 Production Build 与 Pages subpath 验证**

运行：`npm run build`  
运行：`node scripts/validate_pages_build.mjs --base /CoolRoute_Tokyo/`  
预期：Build PASS，`dist/data/shade.json` 存在，所有静态资源使用配置 base path。

- [ ] **步骤 6：验证未修改 Graph 和提交范围**

运行：`git diff --exit-code 3a67873 -- public/data/graph.json`  
运行：`git diff --cached --name-only`  
预期：Graph 无差异；Raw、Processed、临时 QA、Secret、本机路径和无关 M1 文档不在 staged files。

- [ ] **步骤 7：完成 M10 提交与 Push**

若前面使用检查点提交，保留正常历史，不 squash、不 rewrite；最终文档提交使用：

```bash
git add README.md docs/DATA_SOURCES.md docs/METHODOLOGY.md docs/PROJECT_OVERVIEW_JA.md src/config/dataSources.js docs/superpowers/specs/2026-08-21-m10-building-shade-design.md docs/superpowers/plans/2026-08-21-m10-building-shade.md
git commit -m "docs: document building shade pipeline"
git push origin main
```

- [ ] **步骤 8：停止在 M10**

报告 A/B/C/D 结果、真实 PLATEAU 质量、Shade 分布、文件大小、性能、测试、Build、Commit/Push 和已知模型限制；不进入 M11 Tokyo Scale。
