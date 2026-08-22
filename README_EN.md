# CoolRoute Tokyo

[中文](README.md) | [日本語](README_JA.md) | **English**

[Live Demo](https://katenn0613.github.io/CoolRoute_Tokyo/) · [Data Sources](docs/DATA_SOURCES.md) · [Japanese Project Overview](docs/PROJECT_OVERVIEW_JA.md)

CoolRoute Tokyo is a hackathon web application for comparing walking routes in Tokyo's hot-weather environment.

- **Fastest Route**: uses road distance as the only cost;
- **Balanced Route**: balances walking distance and modelled heat exposure;
- **Coolest Route**: gives modelled heat exposure a higher weight.

The application runs entirely in the browser and is deployed through GitHub Pages. It does not depend on an online backend, database, or remote routing API.

> Heat Exposure Score is a modelled indicator for route comparison. It is not heatstroke probability, medical risk, or a medically validated risk-reduction percentage. Actual conditions may differ from the model estimate.

## Current status

- Production coverage: Tokyo's 23 special wards;
- Road Graph: 409,472 nodes;
- Original directed edges: 1,206,772;
- Derived ward-boundary connector edges: 22;
- Total Production edges: 1,206,794;
- Building Shade: Project PLATEAU, 671 source meshes;
- Shade scenarios: equinox day at 09:00, 12:00, and 15:00;
- Browser Graph Schema: `1.1.0`; Shade Schema: `1.0.0`.

## How to use

1. Click the map to select a start point;
2. Click again to select a destination;
3. The browser calculates and displays all three routes;
4. Select a Route Card to highlight a route;
5. Select 09:00, 12:00, or 15:00 to apply the corresponding precomputed building-shade scenario to Balanced/Coolest routing.

A point must be inside the configured Tokyo23 bounds and within 300 metres of a walking-road node.

## Model

```text
baseHeatExposure
= 0.7 × (1 - green_score)
+ 0.3 × water_penalty

shadeAwareHeatExposure
= 0.75 × baseHeatExposure
+ 0.25 × (1 - shade_score)

Fastest:  distance
Balanced: distance × (1 + 1 × shadeAwareHeatExposure)
Coolest:  distance × (1 + 3 × shadeAwareHeatExposure)
```

Fastest does not read Shade. Balanced and Coolest reuse the same browser-side Weighted Dijkstra and differ only through their weight functions.

## Data and architecture

- React + Vite + JavaScript; MapLibre GL JS;
- client-side Weighted Dijkstra in a Web Worker;
- Roads: OpenStreetMap walking network;
- Green: official Tokyo Metropolitan Government Green Open Data GIS;
- Water: Tokyowater Drinking Stations;
- Building Shade: MLIT Project PLATEAU CityGML;
- GIS runs offline during development/build time; Production is a static GitHub Pages site with no online backend.

The browser reads only a compact binary graph, environment metadata, GeoJSON, and MVT. It does not parse Shapefile, GraphML, or CityGML at runtime. See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) for sources and known licences.

## Local development

```bash
npm ci
npm run dev
npm test -- --run
npm run build -- --base /CoolRoute_Tokyo/
```

## Main directories

```text
public/data/       Static Production Data used by the browser
src/components/    React UI and MapLibre interaction
src/routing/       Graph, snapping, Dijkstra, and route metrics
src/shade/         Shade sidecar and layer logic
scripts/           Offline GIS and data-build scripts
tests/             Tests and synthetic fixtures
docs/              Data, methodology, evaluation, and milestone documents
```

## Known limitations and future improvements

- The Tokyo23 Road Graph was initially downloaded and simplified ward by ward, creating topology discontinuities at administrative boundaries. The current hackathon build uses 11 distance-screened, bidirectional derived connections to join the 12 major components that contain more than 99.8% of all nodes. Eight small isolated components remain unchanged.
- These derived connections repair short discontinuities between major components; they do not prove that the complete real-world road topology is correct. Connection locations and rules are recorded in [`topology_repair_tokyo23.json`](public/data/topology_repair_tokyo23.json).
- A future rebuild will generate the OSM walking network from one unified Tokyo23 polygon and replace the temporary ward-boundary connections with formally reconstructed road topology.
- `green_score` is a proxy for official actual-green-coverage polygons within a 15-metre road buffer. It is not shade.
- Building Shade is an offline geometric projection, not measured shade, road temperature, or a weather forecast. Weather is not included in Production.
- The project does not claim to guarantee safety, prevent disease, or provide medically validated benefits.

## Data integrity policy

The project does not fabricate official Tokyo open data. Missing data is disclosed and is not silently replaced with synthetic Production Data. Synthetic fixtures are restricted to tests.
