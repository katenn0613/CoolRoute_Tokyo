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
      await response.json()
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
