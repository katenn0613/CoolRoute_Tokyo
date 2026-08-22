import { createReadStream } from 'node:fs'
import { access, readFile, readdir, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { prepareGraph, validateGraphPayload } from '../src/routing/graphLoader.js'
import { validateShadePayload } from '../src/shade/shadeLoader.js'

const REQUIRED_DATA_FILES = [
  'data/graph_tokyo_core5.json',
  'data/environment_metadata_tokyo_core5.json',
  'data/drinking_stations_tokyo_core5.geojson',
  'data/service_area_tokyo_core5.geojson',
  'data/shade_tokyo_core5.json',
  'data/graph_tokyo23.bin',
  'data/graph_tokyo23.bin.gz',
  'data/graph_tokyo23_runtime_metadata.json',
  'data/shade_metadata_tokyo23.json',
  'data/drinking_stations_tokyo23.geojson',
  'data/tiles/heat.json',
  'data/tiles/shade.json',
]

export function normalizeBasePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    throw new Error('Pages Base Path must be an absolute URL path.')
  }
  const normalized = `/${value.split('/').filter(Boolean).join('/')}/`
  return normalized === '//' ? '/' : normalized
}

function isLocalReference(value) {
  return !/^(?:[a-z]+:|#|\/\/)/i.test(value)
}

function extractLocalAssets(html) {
  const references = []
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
    if (isLocalReference(match[1])) references.push(match[1])
  }
  return references
}

async function readJson(filePath, label) {
  let contents
  try {
    contents = await readFile(filePath, 'utf8')
  } catch (error) {
    throw new Error(`${label} is missing.`, { cause: error })
  }
  try {
    return JSON.parse(contents)
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`, { cause: error })
  }
}

function validateStations(payload) {
  if (!payload || payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
    throw new Error('Drinking Stations must be a GeoJSON FeatureCollection.')
  }
  for (const [index, feature] of payload.features.entries()) {
    const coordinates = feature?.geometry?.coordinates
    if (
      feature?.type !== 'Feature'
      || feature?.geometry?.type !== 'Point'
      || !Array.isArray(coordinates)
      || coordinates.length !== 2
      || !Number.isFinite(coordinates[0])
      || !Number.isFinite(coordinates[1])
      || coordinates[0] < -180
      || coordinates[0] > 180
      || coordinates[1] < -90
      || coordinates[1] > 90
    ) {
      throw new Error(`Drinking Station feature ${index} has invalid Point coordinates.`)
    }
  }
  return payload.features.length
}

function validateServiceArea(payload) {
  const feature = payload?.features?.[0]
  if (
    payload?.type !== 'FeatureCollection'
    || !feature
    || !['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)
    || feature?.properties?.wardIds?.join(',') !== '13101,13102,13103,13104,13105'
  ) {
    throw new Error('Core5 Service Area must contain the fixed five-ward Polygon.')
  }
  return feature.properties.wardIds
}

async function listFiles(directory, relativeDirectory = '') {
  const entries = await readdir(path.join(directory, relativeDirectory), { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFiles(directory, relativePath))
    } else {
      files.push(relativePath)
    }
  }
  return files
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8'
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8'
  if (filePath.endsWith('.json') || filePath.endsWith('.geojson')) {
    return 'application/json; charset=utf-8'
  }
  return 'application/octet-stream'
}

async function startArtifactServer(distDirectory, basePath) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
      if (!pathname.startsWith(basePath)) {
        response.writeHead(404).end('Not Found')
        return
      }
      const requested = pathname === basePath ? 'index.html' : pathname.slice(basePath.length)
      const relativePath = path.posix.normalize(requested)
      if (relativePath.startsWith('../') || path.posix.isAbsolute(relativePath)) {
        response.writeHead(404).end('Not Found')
        return
      }
      const filePath = path.resolve(distDirectory, relativePath)
      const rootPath = `${path.resolve(distDirectory)}${path.sep}`
      if (!filePath.startsWith(rootPath)) {
        response.writeHead(404).end('Not Found')
        return
      }
      const fileStat = await stat(filePath)
      if (!fileStat.isFile()) throw new Error('Not a file')
      response.writeHead(200, { 'content-type': contentType(filePath) })
      createReadStream(filePath).pipe(response)
    } catch {
      response.writeHead(404).end('Not Found')
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    }),
  }
}

async function verifyArtifactHttp(distDirectory, basePath) {
  const server = await startArtifactServer(distDirectory, basePath)
  try {
    const pageResponse = await fetch(`${server.origin}${basePath}`)
    if (!pageResponse.ok || !(await pageResponse.text()).includes('<html')) {
      throw new Error('Pages index failed the Subpath HTTP check.')
    }
    for (const relativePath of REQUIRED_DATA_FILES) {
      const response = await fetch(`${server.origin}${basePath}${relativePath}`)
      if (!response.ok) throw new Error(`${relativePath} failed the Subpath HTTP check.`)
      if (/\.(?:json|geojson)$/.test(relativePath)) await response.json()
      else await response.arrayBuffer()
    }
    const rootResponse = await fetch(`${server.origin}/`)
    const rootDataResponse = await fetch(`${server.origin}/data/graph_tokyo_core5.json`)
    if (basePath !== '/' && (rootResponse.status !== 404 || rootDataResponse.status !== 404)) {
      throw new Error('Root URLs unexpectedly bypassed the configured Pages Base Path.')
    }
    return {
      verified: true,
      rootPathStatus: rootResponse.status,
      rootDataPathStatus: rootDataResponse.status,
    }
  } finally {
    await server.close()
  }
}

async function validateTokyo23Binary(distDirectory) {
  const binaryPath = path.join(distDirectory, 'data/graph_tokyo23.bin')
  let binary
  try {
    binary = await readFile(binaryPath)
  } catch (error) {
    throw new Error('graph_tokyo23.bin is missing.', { cause: error })
  }
  if (binary.byteLength < 24 || binary.readUInt32LE(0) !== 0x52434752) {
    throw new Error('graph_tokyo23.bin has an invalid Binary Graph header.')
  }
  const header = {
    version: binary.readUInt32LE(4),
    nodeCount: binary.readUInt32LE(8),
    edgeCount: binary.readUInt32LE(12),
    pointCount: binary.readUInt32LE(16),
    scenarioCount: binary.readUInt32LE(20),
  }
  const expectedSize = 24
    + header.nodeCount * 8
    + header.edgeCount * 20
    + (header.edgeCount + 1) * 4
    + header.pointCount * 8
    + header.edgeCount * header.scenarioCount * 4
  if (
    header.version !== 1
    || header.nodeCount <= 0
    || header.edgeCount <= 0
    || header.pointCount <= 0
    || header.scenarioCount !== 3
    || expectedSize !== binary.byteLength
  ) throw new Error('graph_tokyo23.bin header counts or file size are invalid.')

  const compressedPath = path.join(distDirectory, 'data/graph_tokyo23.bin.gz')
  const compressed = await readFile(compressedPath).catch((error) => {
    throw new Error('graph_tokyo23.bin.gz is missing.', { cause: error })
  })
  if (compressed.byteLength < 2 || compressed[0] !== 0x1f || compressed[1] !== 0x8b) {
    throw new Error('graph_tokyo23.bin.gz is not a gzip payload.')
  }

  const metadata = await readJson(
    path.join(distDirectory, 'data/graph_tokyo23_runtime_metadata.json'),
    'graph_tokyo23_runtime_metadata.json',
  )
  for (const field of ['version', 'nodeCount', 'edgeCount', 'pointCount', 'scenarioCount']) {
    if (metadata?.binaryGraph?.[field] !== header[field]) {
      throw new Error(`Tokyo23 Runtime Metadata ${field} does not match Binary Graph.`)
    }
  }
  if (!Number.isInteger(metadata?.binaryGraph?.weakComponentCount) || metadata.binaryGraph.weakComponentCount <= 0) {
    throw new Error('Tokyo23 Runtime Metadata weakComponentCount is invalid.')
  }
  return { ...header, weakComponentCount: metadata.binaryGraph.weakComponentCount }
}

async function validateTileSet(distDirectory, name) {
  const manifest = await readJson(
    path.join(distDirectory, `data/tiles/${name}.json`),
    `${name}.json`,
  )
  if (
    manifest?.tilejson !== '3.0.0'
    || !Number.isInteger(manifest.minzoom)
    || !Number.isInteger(manifest.maxzoom)
    || !Array.isArray(manifest.tiles)
    || !manifest.tiles.some((template) => template.includes(`data/tiles/${name}/`))
  ) throw new Error(`${name} MVT manifest is invalid.`)
  const tileDirectory = path.join(distDirectory, `data/tiles/${name}`)
  const tiles = await listFiles(tileDirectory).catch((error) => {
    throw new Error(`${name} MVT directory is missing.`, { cause: error })
  })
  if (!tiles.some((file) => file.endsWith('.pbf'))) throw new Error(`${name} MVT tiles are missing.`)
  return tiles.filter((file) => file.endsWith('.pbf')).length
}

export async function validatePagesBuild({ distDirectory, basePath, verifyHttp = true }) {
  const normalizedBasePath = normalizeBasePath(basePath)
  const resolvedDist = path.resolve(distDirectory)
  const indexPath = path.join(resolvedDist, 'index.html')
  const html = await readFile(indexPath, 'utf8').catch((error) => {
    throw new Error('index.html is missing.', { cause: error })
  })
  const assetReferences = extractLocalAssets(html)
  if (assetReferences.length === 0) throw new Error('index.html contains no local assets.')

  for (const reference of assetReferences) {
    if (!reference.startsWith(normalizedBasePath)) {
      throw new Error(`Asset URL does not use Pages Base Path: ${reference}`)
    }
    const relativePath = reference.slice(normalizedBasePath.length).split(/[?#]/, 1)[0]
    await access(path.join(resolvedDist, relativePath)).catch((error) => {
      throw new Error(`Referenced asset is missing: ${relativePath}`, { cause: error })
    })
  }

  const files = await listFiles(resolvedDist)
  const workerFiles = files.filter((file) => /maplibre-gl.*worker.*\.js$/i.test(file))
  if (workerFiles.length === 0) throw new Error('MapLibre Worker asset is missing.')
  const JavaScriptFiles = files.filter((file) => file.endsWith('.js') && !workerFiles.includes(file))
  const JavaScriptContents = await Promise.all(
    JavaScriptFiles.map((file) => readFile(path.join(resolvedDist, file), 'utf8')),
  )
  for (const workerFile of workerFiles) {
    if (!JavaScriptContents.some((contents) => contents.includes(path.posix.basename(workerFile)))) {
      throw new Error(`MapLibre Worker asset is not referenced: ${workerFile}`)
    }
  }

  const graphPayload = await readJson(
    path.join(resolvedDist, 'data/graph_tokyo_core5.json'),
    'graph_tokyo_core5.json',
  )
  validateGraphPayload(graphPayload)
  const environmentMetadata = await readJson(
    path.join(resolvedDist, 'data/environment_metadata_tokyo_core5.json'),
    'environment_metadata_tokyo_core5.json',
  )
  if (!environmentMetadata || typeof environmentMetadata !== 'object' || Array.isArray(environmentMetadata)) {
    throw new Error('Environment Metadata must be a JSON object.')
  }
  const stations = await readJson(
    path.join(resolvedDist, 'data/drinking_stations_tokyo_core5.geojson'),
    'drinking_stations_tokyo_core5.geojson',
  )
  const drinkingStationCount = validateStations(stations)
  const serviceArea = await readJson(
    path.join(resolvedDist, 'data/service_area_tokyo_core5.geojson'),
    'service_area_tokyo_core5.geojson',
  )
  const wardIds = validateServiceArea(serviceArea)
  const shade = await readJson(
    path.join(resolvedDist, 'data/shade_tokyo_core5.json'),
    'shade_tokyo_core5.json',
  )
  validateShadePayload(shade, prepareGraph(graphPayload))
  const tokyo23 = await validateTokyo23Binary(resolvedDist)
  const tokyo23Stations = await readJson(
    path.join(resolvedDist, 'data/drinking_stations_tokyo23.geojson'),
    'drinking_stations_tokyo23.geojson',
  )
  validateStations(tokyo23Stations)
  const shadeMetadata = await readJson(
    path.join(resolvedDist, 'data/shade_metadata_tokyo23.json'),
    'shade_metadata_tokyo23.json',
  )
  if (
    shadeMetadata?.schemaVersion !== '1.0.0'
    || shadeMetadata?.edgeCount !== tokyo23.edgeCount
    || shadeMetadata?.scenarios?.join(',') !== '09:00,12:00,15:00'
  ) throw new Error('shade_metadata_tokyo23.json does not match the Binary Graph.')
  tokyo23.heatTileCount = await validateTileSet(resolvedDist, 'heat')
  tokyo23.shadeTileCount = await validateTileSet(resolvedDist, 'shade')
  const http = verifyHttp
    ? await verifyArtifactHttp(resolvedDist, normalizedBasePath)
    : { verified: false }

  return {
    basePath: normalizedBasePath,
    assetCount: assetReferences.length,
    workerCount: workerFiles.length,
    graph: {
      nodeCount: graphPayload.metadata.nodeCount,
      edgeCount: graphPayload.metadata.edgeCount,
      graphVersion: graphPayload.metadata.graphVersion,
    },
    drinkingStationCount,
    wardIds,
    shadeEdgeCount: Object.keys(shade.edgeShadeScores).length,
    tokyo23,
    http,
  }
}

function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (name === '--dist') options.distDirectory = value
    if (name === '--base-path') options.basePath = value
  }
  if (!options.distDirectory || !options.basePath) {
    throw new Error('Usage: node scripts/validate_pages_build.mjs --dist <path> --base-path <path>')
  }
  return options
}

const isDirectInvocation = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectInvocation) {
  try {
    const result = await validatePagesBuild(parseArguments(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`Pages build validation failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
