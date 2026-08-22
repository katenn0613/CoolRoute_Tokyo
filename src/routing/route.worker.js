import { routingConfig } from '../config/routingConfig.js'
import { decodeBinaryGraph, materializeEdge, scenarioIndex } from './binaryGraph.js'
import {
  buildAdjacency,
  findNearestNodeBinary,
  weightedDijkstraBinary,
} from './binaryRouting.js'
import { ROUTING_MODES } from './exposureModel.js'
import {
  compareRouteToFastest,
  compareShadeAwareRouteToFastest,
  passesDetourGuard,
} from './routeComparison.js'
import { buildRouteGeoJSON } from './routeGeometry.js'
import { calculateRouteMetrics } from './routeMetrics.js'

let graph = null
let adjacency = null
let boundingBox = null

function respond(id, payload) {
  self.postMessage({ id, ...payload })
}

function respondError(id, error, code = 'route-engine') {
  respond(id, {
    ok: false,
    error: { message: error instanceof Error ? error.message : String(error), code },
  })
}

async function fetchArrayBuffer(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`二进制图加载失败（HTTP ${response.status}）。`)
  return response.arrayBuffer()
}

async function fetchGzipArrayBuffer(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`二进制图加载失败（HTTP ${response.status}）。`)
  if (!response.body) throw new Error('压缩图响应没有可读取的数据流。')
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
}

async function loadGraphBinary(compressedUrl, rawUrl) {
  if (typeof DecompressionStream === 'undefined') return fetchArrayBuffer(rawUrl)
  try {
    return await fetchGzipArrayBuffer(compressedUrl)
  } catch {
    return fetchArrayBuffer(rawUrl)
  }
}

function createShadeContext(edges, scenario) {
  const scoreByEdgeId = new Map()
  const shadeScenarioIndex = scenarioIndex(scenario)
  for (const edge of edges) {
    scoreByEdgeId.set(
      edge.id,
      graph.shade[Number(edge.id) * graph.scenarioCount + shadeScenarioIndex],
    )
  }
  return {
    scenario,
    shadeWeight: routingConfig.shadeContributionWeight,
    scoreByEdgeId,
    sourceMetadata: {
      shadeSchemaVersion: '1.0.0',
      roadGraphSchemaVersion: '1.1.0',
      roadGraphGeneratedAt: '',
    },
  }
}

function calculateBundle(startIndex, destinationIndex, scenario) {
  const bundleStartedAt = performance.now()
  const routes = {}
  const hasShade = graph.scenarioCount > 0
  for (const mode of Object.values(ROUTING_MODES)) {
    const startedAt = performance.now()
    const result = weightedDijkstraBinary(graph, adjacency, startIndex, destinationIndex, {
      mode,
      scenario: mode === ROUTING_MODES.FASTEST || !hasShade ? null : scenario,
    })
    if (!result.found) throw new Error('所选两点位于不连通的道路组件，找不到可通行路线。')
    const edges = result.edgeSequence.map((edgeIndex) => materializeEdge(graph, edgeIndex))
    const shadeContext = hasShade ? createShadeContext(edges, scenario) : null
    routes[mode] = {
      mode,
      result: { ...result, nodeSequence: [...result.nodeSequence], edgeSequence: edges },
      geoJSON: buildRouteGeoJSON(edges),
      metrics: calculateRouteMetrics(edges, routingConfig, shadeContext),
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

  return {
    routes,
    comparisons: {
      balanced: compareRouteToFastest(routes.balanced.metrics, routes.fastest.metrics),
      coolest: compareRouteToFastest(routes.coolest.metrics, routes.fastest.metrics),
    },
    shadeAwareComparisons: hasShade ? {
      balanced: compareShadeAwareRouteToFastest(routes.balanced.metrics, routes.fastest.metrics),
      coolest: compareShadeAwareRouteToFastest(routes.coolest.metrics, routes.fastest.metrics),
    } : null,
    totalCalculationTimeMs: performance.now() - bundleStartedAt,
  }
}

self.onmessage = async (event) => {
  const { id, type } = event.data ?? {}
  try {
    if (type === 'init') {
      const startedAt = performance.now()
      const {
        graphUrl,
        rawGraphUrl,
        shadeMetadataUrl,
        boundingBox: nextBoundingBox,
      } = event.data
      boundingBox = nextBoundingBox
      graph = decodeBinaryGraph(await loadGraphBinary(graphUrl, rawGraphUrl))
      adjacency = buildAdjacency(graph)
      let shadeCoverage = null
      if (graph.scenarioCount > 0 && shadeMetadataUrl) {
        try {
          const response = await fetch(shadeMetadataUrl)
          if (response.ok) shadeCoverage = (await response.json()).quality ?? null
        } catch {
          shadeCoverage = null
        }
      }
      respond(id, {
        ok: true,
        nodeCount: graph.nodeCount,
        edgeCount: graph.edgeCount,
        loadTimeMs: performance.now() - startedAt,
        shadeAvailable: graph.scenarioCount > 0,
        shadeCoverage,
      })
      return
    }
    if (!graph || !adjacency) throw new Error('Road Graph 尚未初始化。')
    if (type === 'snap') {
      respond(id, {
        ok: true,
        ...findNearestNodeBinary(graph, event.data.point, {
          boundingBox,
          maximumDistanceMeters: event.data.maxMeters,
        }),
      })
      return
    }
    if (type === 'route') {
      respond(id, {
        ok: true,
        ...calculateBundle(
          event.data.startIndex,
          event.data.destinationIndex,
          event.data.scenario,
        ),
      })
      return
    }
    throw new Error(`未知的 Worker 消息类型：${type}`)
  } catch (error) {
    const code = type === 'init' ? 'graph-load' : type === 'snap' ? 'snap' : type === 'route' ? 'route' : 'route-engine'
    respondError(id, error, code)
  }
}
