import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  normalizeBasePath,
  validatePagesBuild,
} from '../../scripts/validate_pages_build.mjs'

const temporaryDirectories = []

function validGraph() {
  return {
    metadata: {
      graphVersion: '1.1.0',
      generatedAt: 'graph-baseline',
      nodeCount: 2,
      edgeCount: 1,
    },
    nodes: {
      a: { id: 'a', lon: 139.76, lat: 35.68 },
      b: { id: 'b', lon: 139.761, lat: 35.681 },
    },
    edges: [{
      id: 'a-b-0',
      source: 'a',
      target: 'b',
      length: 140,
      geometry: [[139.76, 35.68], [139.761, 35.681]],
      green_score: 0.25,
      water_penalty: 0.3,
    }],
  }
}

function validStations() {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [139.76, 35.68] },
      properties: { name: 'テスト給水スポット' },
    }],
  }
}

function validShade() {
  return {
    metadata: {
      schemaVersion: '1.0.0',
      scenarios: ['09:00', '12:00', '15:00'],
      roadGraphSchemaVersion: '1.1.0',
      roadGraphGeneratedAt: 'graph-baseline',
      edgeCount: 1,
    },
    edgeShadeScores: { 'a-b-0': [0.2, 0.5, 0.3] },
  }
}

async function createArtifact({
  basePath = '/demo-repo/',
  graph = validGraph(),
  environmentMetadata = { schemaVersion: '1.0.0' },
  stations = validStations(),
  shade = validShade(),
  htmlAssetBasePath = basePath,
  includeWorker = true,
  referenceWorker = true,
  indexMarkup,
} = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'coolroute-pages-'))
  temporaryDirectories.push(directory)
  await mkdir(path.join(directory, 'assets'), { recursive: true })
  await mkdir(path.join(directory, 'data'), { recursive: true })

  await writeFile(
    path.join(directory, 'index.html'),
    indexMarkup
      ?? `<!doctype html><html><head><link rel="stylesheet" href="${htmlAssetBasePath}assets/app.css"></head><body><script type="module" src="${htmlAssetBasePath}assets/app.js"></script></body></html>`,
  )
  await writeFile(
    path.join(directory, 'assets/app.js'),
    referenceWorker ? 'const worker = "maplibre-gl-worker-test.js";' : 'const app = true;',
  )
  await writeFile(path.join(directory, 'assets/app.css'), 'body { margin: 0; }')
  if (includeWorker) {
    await writeFile(path.join(directory, 'assets/maplibre-gl-worker-test.js'), 'self.onmessage = () => {};')
  }
  if (graph !== null) {
    await writeFile(path.join(directory, 'data/graph.json'), JSON.stringify(graph))
  }
  if (environmentMetadata !== null) {
    await writeFile(
      path.join(directory, 'data/environment_metadata.json'),
      JSON.stringify(environmentMetadata),
    )
  }
  if (stations !== null) {
    await writeFile(
      path.join(directory, 'data/drinking_stations.geojson'),
      JSON.stringify(stations),
    )
  }
  if (shade !== null) {
    await writeFile(path.join(directory, 'data/shade.json'), JSON.stringify(shade))
  }

  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

describe('normalizeBasePath', () => {
  it('normalizes an absolute repository path with one trailing slash', () => {
    expect(normalizeBasePath('/demo-repo')).toBe('/demo-repo/')
    expect(normalizeBasePath('/demo-repo/')).toBe('/demo-repo/')
  })

  it('rejects a relative deployment path', () => {
    expect(() => normalizeBasePath('demo-repo')).toThrow(/absolute/i)
  })
})

describe('validatePagesBuild', () => {
  it('validates the artifact and its repository-subpath HTTP behavior', async () => {
    const distDirectory = await createArtifact()

    await expect(validatePagesBuild({
      distDirectory,
      basePath: '/demo-repo/',
      verifyHttp: true,
    })).resolves.toMatchObject({
      basePath: '/demo-repo/',
      assetCount: 2,
      graph: { nodeCount: 2, edgeCount: 1, graphVersion: '1.1.0' },
      drinkingStationCount: 1,
      shadeEdgeCount: 1,
      http: {
        verified: true,
        rootPathStatus: 404,
        rootDataPathStatus: 404,
      },
    })
  })

  it('rejects root-relative assets that bypass a repository Base Path', async () => {
    const distDirectory = await createArtifact({ htmlAssetBasePath: '/' })

    await expect(validatePagesBuild({
      distDirectory,
      basePath: '/demo-repo/',
      verifyHttp: false,
    })).rejects.toThrow(/Base Path/)
  })

  it.each([
    ['graph.json', { graph: null }],
    ['environment_metadata.json', { environmentMetadata: null }],
    ['drinking_stations.geojson', { stations: null }],
    ['shade.json', { shade: null }],
  ])('rejects a missing required production resource: %s', async (label, options) => {
    const distDirectory = await createArtifact(options)

    await expect(validatePagesBuild({
      distDirectory,
      basePath: '/demo-repo/',
      verifyHttp: false,
    })).rejects.toThrow(label)
  })

  it('reuses the production Graph validator for schema and environment fields', async () => {
    const graph = validGraph()
    graph.edges[0].green_score = Number.NaN
    const distDirectory = await createArtifact({ graph })

    await expect(validatePagesBuild({
      distDirectory,
      basePath: '/demo-repo/',
      verifyHttp: false,
    })).rejects.toThrow(/green_score/)
  })

  it.each([
    { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }] },
    { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [200, 35] } }] },
    { type: 'Feature', features: [] },
  ])('rejects malformed Drinking Station GeoJSON', async (stations) => {
    const distDirectory = await createArtifact({ stations })

    await expect(validatePagesBuild({
      distDirectory,
      basePath: '/demo-repo/',
      verifyHttp: false,
    })).rejects.toThrow(/Drinking Station/)
  })

  it('rejects a missing MapLibre Worker artifact', async () => {
    const distDirectory = await createArtifact({ includeWorker: false })

    await expect(validatePagesBuild({
      distDirectory,
      basePath: '/demo-repo/',
      verifyHttp: false,
    })).rejects.toThrow(/Worker asset is missing/)
  })

  it('rejects a MapLibre Worker that is not referenced by an emitted bundle', async () => {
    const distDirectory = await createArtifact({ referenceWorker: false })

    await expect(validatePagesBuild({
      distDirectory,
      basePath: '/demo-repo/',
      verifyHttp: false,
    })).rejects.toThrow(/Worker asset is not referenced/)
  })

  it('closes its HTTP server when Subpath verification fails', async () => {
    const distDirectory = await createArtifact({
      indexMarkup: '<!doctype html><body><link rel="stylesheet" href="/demo-repo/assets/app.css"><script src="/demo-repo/assets/app.js"></script></body>',
    })

    await expect(validatePagesBuild({
      distDirectory,
      basePath: '/demo-repo/',
      verifyHttp: true,
    })).rejects.toThrow(/index failed/)

    await writeFile(
      path.join(distDirectory, 'index.html'),
      '<html><link rel="stylesheet" href="/demo-repo/assets/app.css"><script src="/demo-repo/assets/app.js"></script></html>',
    )
    await expect(validatePagesBuild({
      distDirectory,
      basePath: '/demo-repo/',
      verifyHttp: true,
    })).resolves.toMatchObject({ http: { verified: true } })
  })
})
