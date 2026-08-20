const ROUTING_MODES = Object.freeze(['fastest', 'balanced', 'coolest'])
const COMPARISON_FIELDS = Object.freeze([
  'extraDistanceMeters',
  'extraDistancePercent',
  'extraWalkingMinutes',
  'averageHeatExposureChange',
  'averageHeatExposureReduction',
  'averageHeatExposureReductionPercent',
  'modelledExposureLoadChange',
  'modelledExposureLoadReduction',
  'modelledExposureLoadReductionPercent',
])

export function sameEdgeSequence(first, second) {
  const firstEdges = first?.result?.edgeSequence
  const secondEdges = second?.result?.edgeSequence
  if (!Array.isArray(firstEdges) || !Array.isArray(secondEdges)) return false
  return firstEdges.length === secondEdges.length
    && firstEdges.every((edge, index) => edge.id === secondEdges[index]?.id)
}

function serializeRoute(mode, route) {
  const { metrics, result } = route
  return {
    mode,
    distanceMeters: metrics.distanceMeters,
    walkingTimeSeconds: metrics.walkingTimeSeconds,
    edgeCount: metrics.edgeCount,
    averageHeatExposure: metrics.averageHeatExposure,
    modelledExposureLoad: metrics.modelledExposureLoad,
    greenIndicator: metrics.greenIndicator,
    waterAccessIndicator: metrics.waterAccessIndicator,
    totalCost: result.totalCost,
    edgeIds: result.edgeSequence.map((edge) => edge.id),
  }
}

function serializeComparison(comparison, route, fastestRoute) {
  const output = Object.fromEntries(COMPARISON_FIELDS.map((field) => [field, comparison[field]]))
  output.greenIndicatorChange = route.metrics.greenIndicator - fastestRoute.metrics.greenIndicator
  output.waterAccessIndicatorChange = route.metrics.waterAccessIndicator
    - fastestRoute.metrics.waterAccessIndicator
  return output
}

export function createEvaluationCase({
  index,
  stratum,
  start,
  destination,
  straightDistanceMeters,
  bundle,
}) {
  const routes = Object.fromEntries(
    ROUTING_MODES.map((mode) => [mode, serializeRoute(mode, bundle.routes[mode])]),
  )
  const fastestEqualsBalanced = sameEdgeSequence(bundle.routes.fastest, bundle.routes.balanced)
  const fastestEqualsCoolest = sameEdgeSequence(bundle.routes.fastest, bundle.routes.coolest)
  const balancedEqualsCoolest = sameEdgeSequence(bundle.routes.balanced, bundle.routes.coolest)
  return {
    id: `m7-od-${String(index).padStart(3, '0')}`,
    stratum,
    start: { nodeId: start.id, coordinates: [start.lon, start.lat] },
    destination: { nodeId: destination.id, coordinates: [destination.lon, destination.lat] },
    straightDistanceMeters,
    routes,
    comparisons: {
      balanced: serializeComparison(
        bundle.comparisons.balanced,
        bundle.routes.balanced,
        bundle.routes.fastest,
      ),
      coolest: serializeComparison(
        bundle.comparisons.coolest,
        bundle.routes.coolest,
        bundle.routes.fastest,
      ),
    },
    routeEquality: {
      fastestEqualsBalanced,
      fastestEqualsCoolest,
      balancedEqualsCoolest,
      allThreeEqual: fastestEqualsBalanced && fastestEqualsCoolest,
    },
  }
}
