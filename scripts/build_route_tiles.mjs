import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import geojsonvt from 'geojson-vt'
import vtpbf from 'vt-pbf'

const GRAPH_URL = new URL('../public/data/graph_tokyo23.json', import.meta.url)
const SHADE_URL = new URL('../public/data/shade_tokyo23.json', import.meta.url)
const TILES_DIR_URL = new URL('../public/data/tiles/', import.meta.url)

const MIN_ZOOM = Number(process.env.CR_MIN_ZOOM ?? 10)
const MAX_ZOOM = Number(process.env.CR_MAX_ZOOM ?? 13)
const EXTENT = 4096
const TOLERANCE = Number(process.env.CR_TOLERANCE ?? 3)
const BUFFER = Number(process.env.CR_BUFFER ?? 32)
const BOUNDING_BOX = [139.559, 35.528, 139.918, 35.818] // [west, south, east, north]
const SCENARIOS = ['09:00', '12:00', '15:00']

// 与 src/routing/exposureModel.js 的 calculateEdgeHeatExposure 保持一致。
const GREEN_WEIGHT = 0.7
const WATER_WEIGHT = 0.3

export function lonToTileX(lon, zoom) {
  return Math.floor((lon + 180) / 360 * 2 ** zoom)
}

export function latToTileY(lat, zoom) {
  const radians = lat * Math.PI / 180
  const mercator = Math.log(Math.tan(radians) + 1 / Math.cos(radians))
  return Math.floor((1 - mercator / Math.PI) / 2 * 2 ** zoom)
}

export function tileRange(bbox, zoom) {
  const [west, south, east, north] = bbox
  const minX = lonToTileX(west, zoom)
  const maxX = lonToTileX(east, zoom)
  const minY = latToTileY(north, zoom)
  const maxY = latToTileY(south, zoom)
  return { minX, maxX, minY, maxY }
}

export function buildHeatFeatures(graphPayload) {
  return graphPayload.edges.map((edge) => ({
    type: 'Feature',
    id: edge.id,
    properties: {
      heatExposure: Math.min(
        1,
        Math.max(0, GREEN_WEIGHT * (1 - edge.green_score) + WATER_WEIGHT * edge.water_penalty),
      ),
    },
    geometry: { type: 'LineString', coordinates: edge.geometry },
  }))
}

export function buildShadeFeatures(graphPayload, shadePayload) {
  const scenarioIndexes = SCENARIOS.map((scenario) => (
    shadePayload.metadata.scenarios.indexOf(scenario)
  ))
  const propertyNames = SCENARIOS.map((scenario) => `shade${scenario.replace(':', '')}`)
  return graphPayload.edges.map((edge) => {
    const values = shadePayload.edgeShadeScores[edge.id]
    const properties = {}
    scenarioIndexes.forEach((scenarioIndex, index) => {
      properties[propertyNames[index]] = values[scenarioIndex]
    })
    return {
      type: 'Feature',
      id: edge.id,
      properties,
      geometry: { type: 'LineString', coordinates: edge.geometry },
    }
  })
}

export async function buildRouteTiles({
  graphPayload,
  shadePayload,
  minZoom = MIN_ZOOM,
  maxZoom = MAX_ZOOM,
  boundingBox = BOUNDING_BOX,
  outputDirectory = fileURLToPath(TILES_DIR_URL),
  skipShade = false,
} = {}) {
  const heatIndex = geojsonvt(
    { type: 'FeatureCollection', features: buildHeatFeatures(graphPayload) },
    {
      maxZoom,
      indexMaxZoom: maxZoom,
      tolerance: TOLERANCE,
      extent: EXTENT,
      buffer: BUFFER,
    },
  )
  const layers = [
    { name: 'heat', index: heatIndex },
  ]
  if (!skipShade && shadePayload) {
    layers.push({
      name: 'shade',
      index: geojsonvt(
        { type: 'FeatureCollection', features: buildShadeFeatures(graphPayload, shadePayload) },
        {
          maxZoom,
          indexMaxZoom: maxZoom,
          tolerance: TOLERANCE,
          extent: EXTENT,
          buffer: BUFFER,
        },
      ),
    })
  }

  let tileCount = 0
  let totalBytes = 0
  const perLayer = {}
  for (const { name, index } of layers) {
    let layerBytes = 0
    let layerTiles = 0
    for (let zoom = minZoom; zoom <= maxZoom; zoom += 1) {
      const { minX, maxX, minY, maxY } = tileRange(boundingBox, zoom)
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          const tile = index.getTile(zoom, x, y)
          if (!tile) continue
          const pbf = Buffer.from(vtpbf.fromGeojsonVt({ default: tile }, { version: 2 }))
          if (pbf.length === 0) continue
          const directory = path.join(outputDirectory, name, String(zoom), String(x))
          await mkdir(directory, { recursive: true })
          await writeFile(path.join(directory, `${y}.pbf`), pbf)
          layerTiles += 1
          layerBytes += pbf.length
          tileCount += 1
          totalBytes += pbf.length
        }
      }
    }
    perLayer[name] = { tiles: layerTiles, bytes: layerBytes, mb: +(layerBytes / 1048576).toFixed(2) }
    await writeFile(
      path.join(outputDirectory, `${name}.json`),
      `${JSON.stringify({
        tilejson: '3.0.0',
        name,
        scheme: 'xyz',
        tiles: [`data/tiles/${name}/{z}/{x}/{y}.pbf`],
        minzoom: minZoom,
        maxzoom: maxZoom,
        bounds: boundingBox,
        generatedFrom: 'graph_tokyo23.json + shade_tokyo23.json',
      }, null, 2)}\n`,
    )
  }

  return { tileCount, totalBytes, mb: +(totalBytes / 1048576).toFixed(2), perLayer }
}

async function main() {
  const skipShade = process.env.CR_SKIP_SHADE === '1'
  const [graphPayload, shadePayload] = await Promise.all([
    readFile(GRAPH_URL, 'utf8').then(JSON.parse),
    skipShade ? Promise.resolve(null) : readFile(SHADE_URL, 'utf8').then(JSON.parse),
  ])
  const result = await buildRouteTiles({ graphPayload, shadePayload, skipShade })
  console.log(JSON.stringify({ ...result, outputDirectory: fileURLToPath(TILES_DIR_URL) }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
