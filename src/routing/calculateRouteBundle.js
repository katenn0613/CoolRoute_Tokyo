import { routingConfig } from '../config/routingConfig.js'
import { weightedDijkstra } from './dijkstra.js'
import { ROUTING_MODES, createEdgeWeightFunction } from './exposureModel.js'
import { buildRouteGeoJSON } from './routeGeometry.js'
import { compareRouteToFastest, passesDetourGuard } from './routeComparison.js'
import { calculateRouteMetrics } from './routeMetrics.js'

export class RouteBundleError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RouteBundleError'
  }
}

export function calculateRouteBundle(graph, startId, destinationId, overrides = {}) {
  const config = { ...routingConfig, ...overrides }
  const totalStartedAt = performance.now()
  const routes = {}
  for (const mode of Object.values(ROUTING_MODES)) {
    const startedAt = performance.now()
    const result = weightedDijkstra(graph, startId, destinationId, createEdgeWeightFunction(mode, config))
    if (!result.found) throw new RouteBundleError('所选两点之间找不到可通行路线。')
    routes[mode] = {
      mode,
      result,
      geoJSON: buildRouteGeoJSON(result.edgeSequence),
      metrics: calculateRouteMetrics(result.edgeSequence, config),
      calculationTimeMs: performance.now() - startedAt,
    }
  }

  for (const mode of [ROUTING_MODES.BALANCED, ROUTING_MODES.COOLEST]) {
    if (!passesDetourGuard(
      routes[mode].metrics.distanceMeters,
      routes.fastest.metrics.distanceMeters,
      config.maximumExtraDistanceRatio,
    )) throw new RouteBundleError(`${mode} Route 超过 maximumExtraDistanceRatio。`)
  }

  return {
    routes,
    comparisons: {
      balanced: compareRouteToFastest(routes.balanced.metrics, routes.fastest.metrics),
      coolest: compareRouteToFastest(routes.coolest.metrics, routes.fastest.metrics),
    },
    totalCalculationTimeMs: performance.now() - totalStartedAt,
  }
}
