import { decodeBinaryGraph, materializeEdge, scenarioIndex } from './binaryGraph.js'
import {
  buildAdjacency,
  findNearestNodeBinary,
  weightedDijkstraBinary,
} from './binaryRouting.js'
import { ROUTING_MODES } from './exposureModel.js'
import { buildRouteGeoJSON } from './routeGeometry.js'
import { calculateRouteMetrics } from './routeMetrics.js'
import {
  compareRouteToFastest,
  compareShadeAwareRouteToFastest,
  passesDetourGuard,
} from './routeComparison.js'
import { routingConfig } from '../config/routingConfig.js'

let graph = null
let adjacency = null
let boundingBox = null

function post(id, payload) {
  self.postMessage({ id, ...payload })
}

function postError(id, error, code = 'route-engine') {
  post(id, {
    ok: false,
    error: { message: error instanceof Error ? error.message : String(error), code },
  })
}

async function decompressGzip(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`二进制图加载失败（HTTP ${response.status}）。`)
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).arrayBuffer()
}

async function loadBinary(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`二进制图加载失败（HTTP ${response.status}）。`)
  return response.arrayBuffer()
}

async function loadGraphBinary(graphUrl, rawGraphUrl) {
  if (typeof DecompressionStream === 'undefined') return loadBinary(rawGraphUrl)
  try {
    return await decompressGzip(graphUrl)
  } catch {
    return loadBinary(rawGraphUrl)
  }
}

function buildShadeContext(edgeObjects, scenario) {
  const scores = new Map()
  const scenarioIdx = scenarioIndex(scenario)
  for (const edge of edgeObjects) {
    scores.set(edge.id, graph.shade[Number(edge.id) * graph.scenarioCount + scenarioIdx])
  }
  return {
    scenario,
    shadeWeight: routingConfig.shadeContributionWeight,
    scoreByEdgeId: scores,
    sourceMetadata: {
      shadeSchemaVersion: '1.0.0',
      roadGraphSchemaVersion: '1.1.0',
      roadGraphGeneratedAt: '',
    },
  }
}

function computeBundle(startIndex, destinationIndex, scenario) {
  const totalStartedAt = performance.now()
  const routes = {}
  for (const mode of Object.values(ROUTING_MODES)) {
    const startedAt = performance.now()
    const result = weightedDijkstraBinary(
      graph,
      adjacency,
      startIndex,
      destinationIndex,
      { mode, scenario },
    )
    if (!result.found) throw new Error('所选两点之间找不到可通行路线。')
    const edgeObjects = result.edgeSequence.map((edgeIndex) => materializeEdge(graph, edgeIndex))
    const shadeContext = buildShadeContext(edgeObjects, scenario)
    routes[mode] = {
      mode,
      result: {
        found: true,
        totalDistance: result.totalDistance,
        totalCost: result.totalCost,
        nodeSequence: [...result.nodeSequence],
        edgeSequence: edgeObjects,
      },
      geoJSON: buildRouteGeoJSON(edgeObjects),
      metrics: calculateRouteMetrics(edgeObjects, routingConfig, shadeContext),
      calculationTimeMs: performance.now() - startedAt,
    }
  }

  for (const mode of [ROUTING_MODES.BALANCED, ROUTING_MODES.COOLEST]) {
    if (!passesDetourGuard(
      routes[mode].metrics.distanceMeters,
      routes.fastest.metrics.distanceMeters,
      routingConfig.maximumExtraDistanceRatio,
    )) throw new Error(`${mode} Route 超过 maximumExtraDistanceRatio。`)
  }

  const comparisons = {
    balanced: compareRouteToFastest(routes.balanced.metrics, routes.fastest.metrics),
    coolest: compareRouteToFastest(routes.coolest.metrics, routes.fastest.metrics),
  }
  const shadeAwareComparisons = {
    balanced: compareShadeAwareRouteToFastest(routes.balanced.metrics, routes.fastest.metrics),
    coolest: compareShadeAwareRouteToFastest(routes.coolest.metrics, routes.fastest.metrics),
  }
  return {
    routes,
    comparisons,
    shadeAwareComparisons,
    totalCalculationTimeMs: performance.now() - totalStartedAt,
  }
}

function snapPoint(point, maxMeters) {
  const snapped = findNearestNodeBinary(graph, point, {
    boundingBox,
    maximumDistanceMeters: maxMeters,
  })
  return {
    index: snapped.index,
    lon: snapped.lon,
    lat: snapped.lat,
    distanceMeters: snapped.distanceMeters,
  }
}

self.onmessage = async (event) => {
  const { id, type } = event.data ?? {}
  try {
    if (type === 'init') {
      const startedAt = performance.now()
      const { graphUrl, rawGraphUrl, shadeMetadataUrl, boundingBox: box } = event.data
      boundingBox = box
      let buffer
      try {
        buffer = await loadGraphBinary(graphUrl, rawGraphUrl)
      } catch (error) {
        error.code = 'graph-load'
        throw error
      }
      graph = decodeBinaryGraph(buffer)
      adjacency = buildAdjacency(graph)
      let shadeCoverage = null
      if (shadeMetadataUrl) {
        try {
          const metadata = await (await fetch(shadeMetadataUrl)).json()
          shadeCoverage = metadata.quality ?? null
        } catch {
          shadeCoverage = null
        }
      }
      post(id, {
        ok: true,
        nodeCount: graph.nodeCount,
        edgeCount: graph.edgeCount,
        loadTimeMs: performance.now() - startedAt,
        shadeCoverage,
      })
      return
    }
    if (!graph || !adjacency) throw new Error('Road Graph 尚未初始化。')

    if (type === 'snap') {
      const { point, maxMeters } = event.data
      try {
        post(id, { ok: true, ...snapPoint(point, maxMeters) })
      } catch (error) {
        error.code = 'snap'
        throw error
      }
      return
    }
    if (type === 'route') {
      const { startIndex, destinationIndex, scenario } = event.data
      try {
        post(id, { ok: true, ...computeBundle(startIndex, destinationIndex, scenario) })
      } catch (error) {
        error.code = 'route'
        throw error
      }
      return
    }
    postError(id, new Error(`未知的 Worker 消息类型：${type}`))
  } catch (error) {
    postError(id, error, error?.code ?? 'route-engine')
  }
}
