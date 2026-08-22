# CoolRoute Tokyo

[![中文](https://img.shields.io/badge/README-中文-d9d9d9)](README.md)
[![日本語](https://img.shields.io/badge/README-日本語-d9d9d9)](README_JA.md)
[![English](https://img.shields.io/badge/README-English-16794b)](README_EN.md)

CoolRoute Tokyo is a hackathon web application for comparing walking routes under Tokyo's high-temperature conditions. It presents **Fastest Route**, **Balanced Route**, and **Coolest Route**, allowing users to compare walking time with a non-medical, model-estimated **Heat Exposure Score**.

> **Project status:** M11 Production now covers a connected and fully validated **Tokyo Core 5** area: Chiyoda, Chuo, Minato, Shinjuku, and Bunkyo. Road, Green, Water, and Building Shade use the same service area. Browser Graph Schema remains `1.1.0`, and the production application is fully static with no online backend.

## Live Demo

<https://katenn0613.github.io/CoolRoute_Tokyo/>

See [TOKYO_CORE5_SCALE_REPORT_JA](docs/TOKYO_CORE5_SCALE_REPORT_JA.md) for detailed data-quality statistics and limitations.

## Architecture

- Static frontend: React + Vite + JavaScript
- Map rendering: MapLibre GL JS
- Deployment: GitHub Pages Artifact Workflow
- Routing runtime: browser-side JavaScript
- GIS preprocessing: offline Python during development/build only
- Production backend: none
- Database: none

The deployed application loads versioned Road Graph and environmental JSON/GeoJSON assets from GitHub Pages. It does not call a project-owned routing API or require a persistent server process.

## Three Route Modes

- **Fastest Route (`fastest`):** minimizes total road distance.
- **Balanced Route (`balanced`):** balances walking distance and modelled heat exposure.
- **Coolest Route (`coolest`):** allows additional distance and gives greater weight to lower modelled exposure.

All three modes reuse the same Weighted Dijkstra implementation and are rendered along actual Road Edge Geometry.

## Local Development

```bash
npm install
npm run dev
```

Run tests and a production build:

```bash
npm test -- --run
npm run build
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m unittest discover -s tests/python -v
```

Build and validate using the real GitHub Project Pages subpath:

```bash
npm run build -- --base /CoolRoute_Tokyo/
node scripts/validate_pages_build.mjs --dist dist --base-path /CoolRoute_Tokyo/
```

The production workflow does not hardcode the repository name. It builds with the `base_path` produced by `actions/configure-pages`. `npm run preview` is only a local build-preview tool and is not a production dependency.

Regenerate the M7 route evaluation:

```bash
npm run evaluate:routes
```

The evaluation uses the fixed random seed `20260821` and does not modify the Routing Algorithm, Exposure Formula, weights, lambdas, or Production Graph.

Generate or resume the Tokyo Core 5 Production Data pipeline:

```bash
.venv/bin/python scripts/tokyo_core5/run_pipeline.py --status
.venv/bin/python scripts/tokyo_core5/run_pipeline.py
.venv/bin/python scripts/tokyo_core5/run_pipeline.py --from-stage shade
```

The Core5 Pipeline runs Road → Environment → Shade → Validate. Shade results and progress are saved mesh by mesh. Raw GML is deleted immediately after successful validation, and resuming does not depend on already deleted Raw files.

## Coverage

Production uses the Tokyo Core 5 dataset. Its center is `[139.7421134, 35.6806304]`, and the administrative-union bounding box is `[139.6732748, 35.6230363, 139.7931527, 35.7359098]`. The single source of truth is `config/tokyo_core5_area.json`.

The browser also loads `service_area_tokyo_core5.geojson`, so Start and Destination must be inside the actual five-ward union polygon rather than merely inside a rectangular bounding box. The original Demo and diagnostic Tokyo23 files remain in the repository but are not the production defaults.

## Repository Layout

```text
.
├── .github/workflows/    # GitHub Pages build and deployment
├── data/
│   ├── processed/        # development-stage GIS outputs
│   └── raw/              # local raw inputs with provenance records
├── docs/                 # design, evaluation, and data-quality documents
├── evaluation/           # M7 per-OD results and summaries
├── public/data/          # browser-readable static production assets
├── scripts/              # offline OSM/GIS processing and validation
├── src/
│   ├── components/       # React UI
│   ├── config/           # map, area, and data-source configuration
│   ├── routing/          # browser graph and routing logic
│   └── utils/            # shared utilities
├── tests/                # deterministic tests and synthetic fixtures
├── AGENTS.md             # binding repository development rules
└── PROJECT_SPEC.md       # product scope and data contracts
```

## Data and Terminology

Production uses the following real datasets:

- OpenStreetMap pedestrian road network
- actual green-coverage polygons selected through a semantic whitelist from Tokyo Metropolitan Government Green Open Data
- Tokyowater Drinking Station data from the Tokyo Metropolitan Government Bureau of Waterworks
- official Project PLATEAU Tokyo 23 Wards 2020 Building CityGML meshes intersecting the Tokyo Core 5 influence area

Official Tokyo data must never be fabricated or silently replaced. Dataset sources, licences, acquisition status, coverage, and processing methods are recorded in [DATA_SOURCES](docs/DATA_SOURCES.md). Synthetic data is restricted to explicitly labelled test fixtures.

`green_score` is a proxy for the proportion of officially defined actual green-coverage polygons inside a 15m road buffer. It is not a shade score, canopy-shadow fraction, measured road temperature, or medical risk. `water_penalty` is based on distance to the nearest official Drinking Station Point; it does not mean that a route passes through that station.

## Heat Exposure Model

M5 Base Exposure:

```text
baseHeatExposure
= 0.7 × (1 - green_score)
+ 0.3 × water_penalty
```

M10.5 Shade-aware Exposure:

```text
shadeAwareHeatExposure
= 0.75 × baseHeatExposure
+ 0.25 × (1 - shade_score)
```

Fastest cost always remains road distance only. Balanced and Coolest reuse the same Weighted Dijkstra with lambdas 1 and 3. Changing the 09:00, 12:00, or 15:00 Shade Context recalculates Balanced and Coolest without changing Fastest.

**Average Heat Exposure Score** is a length-weighted mean per unit distance. **Modelled Exposure Load** is the cumulative proxy `Edge Length × Heat Exposure Score`. They are separate metrics and must not be used interchangeably.

Heat Exposure Score and Heat Exposure Index are model estimates for route comparison. They are not heatstroke probabilities, medical-risk scores, or medically validated risk-reduction percentages.

## Evaluation

M7 sampled 90 directed OD pairs using the fixed random seed `20260821`, stratified by Fastest Route Distance:

- 400–1000m: 30 pairs
- 1000–2000m: 30 pairs
- 2000–3500m: 30 pairs

Samples were not selected based on favourable trade-offs. Under the original Demo Area, data, and model conditions, both Average Heat Exposure and Modelled Exposure Load decreased in 55.6% of Balanced samples and 61.1% of Coolest samples; all three routes were identical in 38.9% of samples. These results cannot be generalized to all of Tokyo or the current full Core5 area and do not represent a medical benefit.

See [evaluation_results.json](evaluation/evaluation_results.json), [evaluation_summary.json](evaluation/evaluation_summary.json), and [EVALUATION_SUMMARY_JA](docs/EVALUATION_SUMMARY_JA.md).

## Building Shade

Building Height is derived only from the Project PLATEAU LOD Geometry Z Range. Complete LOD2 is preferred; otherwise the entire building falls back to LOD1. `measuredHeight` is used only for QA and never participates in formal Shade calculation.

Shade is precomputed offline for 09:00, 12:00, and 15:00 on the fixed reference date `2026-09-23` in `Asia/Tokyo`. The browser does not parse CityGML or generate shadow polygons; it loads the lightweight `shade_tokyo_core5.json` sidecar.

Tokyo Core 5 Production statistics:

- Road Nodes: 60,983
- Directed Road Edges: 181,858
- Weak Components: 1
- PLATEAU meshes: 126 / 126
- Valid Buildings: 293,663
- LOD2 Buildings: 29,561
- LOD1 fallbacks: 264,102
- Shade sidecar: approximately 7.9MB, covering all 181,858 Edge IDs

The Shade Score represents modelled building shade for fixed date/time scenarios. It is not measured shade, tree shade, temperature reduction, weather information, or medical risk.

## Production Deployment

After a push to `main`, GitHub Actions runs JavaScript tests, the Vite Pages-subpath build, Production Data validation, Artifact upload, and GitHub Pages deployment. `dist/` and Raw GIS files are not committed to Git history.

The production runtime consists only of static HTML, JavaScript, CSS, JSON, and GeoJSON files. It uses no backend, database, remote Routing API, or Weather API.

## Current Limitations

- Coverage is the connected Tokyo Core 5 area, not all 23 Tokyo wards.
- OSM road attributes and access rules depend on community-data completeness and update timing.
- Green, Water, and PLATEAU features depend on the source datasets' survey dates and spatial completeness.
- Building Shade is a fixed-date geometric model and does not include real-time weather, tree shade, terrain, materials, or radiation intensity.
- Actual environmental conditions may differ from the model estimates.

