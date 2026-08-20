import { createEdgeWeightFunction } from '../../src/routing/exposureModel.js'
import { compareRouteToFastest } from '../../src/routing/routeComparison.js'
import { calculateRouteMetrics } from '../../src/routing/routeMetrics.js'
import { createEvaluationSummary } from './summary.mjs'
import { serializeJson } from './serializer.mjs'
import { classifyFastestDistance } from './sampler.mjs'

const STRATA = Object.freeze(['short', 'medium', 'long'])
const MODES = Object.freeze(['fastest', 'balanced', 'coolest'])
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
  'greenIndicatorChange',
  'waterAccessIndicatorChange',
])
const METRIC_FIELDS = Object.freeze([
  'distanceMeters',
  'walkingTimeSeconds',
  'edgeCount',
  'averageHeatExposure',
  'modelledExposureLoad',
  'greenIndicator',
  'waterAccessIndicator',
])

function assertFinite(value, label, { minimum = 0, maximum = Number.POSITIVE_INFINITY } = {}) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} 必须是 [${minimum},${maximum}] 内有限数。`)
  }
}

function equalNumber(first, second, tolerance = 1e-9) {
  if (first === null || second === null) return first === second
  return Number.isFinite(first) && Number.isFinite(second) && Math.abs(first - second) <= tolerance
}

function assertApproximateFields(actual, expected, fields, label) {
  for (const field of fields) {
    if (!equalNumber(actual[field], expected[field])) {
      throw new Error(`${label} ${field} 不一致：actual=${actual[field]} expected=${expected[field]}`)
    }
  }
}

function routeEdgeIdsEqual(first, second) {
  return first.length === second.length && first.every((edgeId, index) => edgeId === second[index])
}

function validateRoute(route, mode, graph, config, caseId, startId, destinationId) {
  if (route?.mode !== mode) throw new Error(`${caseId} ${mode} mode 无效。`)
  assertFinite(route.distanceMeters, `${caseId} ${mode} distanceMeters`)
  assertFinite(route.walkingTimeSeconds, `${caseId} ${mode} walkingTimeSeconds`)
  assertFinite(route.edgeCount, `${caseId} ${mode} edgeCount`, { minimum: 1 })
  assertFinite(route.averageHeatExposure, `${caseId} ${mode} averageHeatExposure`, { maximum: 1 })
  assertFinite(route.modelledExposureLoad, `${caseId} ${mode} modelledExposureLoad`)
  assertFinite(route.greenIndicator, `${caseId} ${mode} greenIndicator`, { maximum: 1 })
  assertFinite(route.waterAccessIndicator, `${caseId} ${mode} waterAccessIndicator`, { maximum: 1 })
  assertFinite(route.totalCost, `${caseId} ${mode} totalCost`)
  if (!Array.isArray(route.edgeIds) || route.edgeIds.length === 0 || route.edgeIds.length !== route.edgeCount) {
    throw new Error(`${caseId} ${mode} Edge Sequence 无效。`)
  }
  const edges = route.edgeIds.map((edgeId) => {
    const edge = graph.edges.get(edgeId)
    if (!edge) throw new Error(`${caseId} ${mode} 引用了不存在的 Edge：${edgeId}`)
    return edge
  })
  let cursor = startId
  for (const edge of edges) {
    if (edge.source !== cursor) throw new Error(`${caseId} ${mode} Edge Sequence 与 OD 不连续。`)
    cursor = edge.target
  }
  if (cursor !== destinationId) throw new Error(`${caseId} ${mode} Edge Sequence 与 OD 不连续。`)
  const recalculatedMetrics = calculateRouteMetrics(edges, config)
  assertApproximateFields(route, recalculatedMetrics, METRIC_FIELDS, `${caseId} ${mode} Metrics`)
  const weightFunction = createEdgeWeightFunction(mode, config)
  const recalculatedCost = edges.reduce((sum, edge) => sum + weightFunction(edge), 0)
  if (!equalNumber(route.totalCost, recalculatedCost)) {
    throw new Error(`${caseId} ${mode} totalCost 不一致。`)
  }
}

function validateComparison(item, mode) {
  const fastest = item.routes.fastest
  const candidate = item.routes[mode]
  const expected = {
    ...compareRouteToFastest(candidate, fastest),
    greenIndicatorChange: candidate.greenIndicator - fastest.greenIndicator,
    waterAccessIndicatorChange: candidate.waterAccessIndicator - fastest.waterAccessIndicator,
  }
  assertApproximateFields(
    item.comparisons[mode],
    expected,
    COMPARISON_FIELDS,
    `${item.id} ${mode} Comparison 不一致：`,
  )
}

function validateEquality(item) {
  const fastest = item.routes.fastest.edgeIds
  const balanced = item.routes.balanced.edgeIds
  const coolest = item.routes.coolest.edgeIds
  const expected = {
    fastestEqualsBalanced: routeEdgeIdsEqual(fastest, balanced),
    fastestEqualsCoolest: routeEdgeIdsEqual(fastest, coolest),
    balancedEqualsCoolest: routeEdgeIdsEqual(balanced, coolest),
  }
  expected.allThreeEqual = expected.fastestEqualsBalanced && expected.fastestEqualsCoolest
  for (const [field, value] of Object.entries(expected)) {
    if (item.routeEquality[field] !== value) throw new Error(`${item.id} ${field} 不一致。`)
  }
}

export function validateEvaluationResults(results, graph, {
  expectedGraphSha256 = results?.metadata?.graphSha256,
  expectedPerStratum = 30,
} = {}) {
  if (!results || results.metadata?.evaluationSchemaVersion !== '1.0.0') {
    throw new Error('Evaluation Results Schema Version 无效。')
  }
  if (!(graph?.nodes instanceof Map) || !(graph?.edges instanceof Map)) {
    throw new Error('Evaluation Validation 需要已准备的 Production Graph。')
  }
  if (results.metadata.graphSha256 !== expectedGraphSha256) {
    throw new Error('Evaluation Results Graph SHA-256 与输入不一致。')
  }
  if (results.metadata.graphNodeCount !== graph.nodes.size || results.metadata.graphEdgeCount !== graph.edges.size) {
    throw new Error('Evaluation Results Graph 数量与输入不一致。')
  }
  for (const field of ['edgeScoresModified', 'routingAlgorithmModified', 'exposureFormulaModified']) {
    if (results.metadata[field] !== false) throw new Error(`${field} 必须为 false。`)
  }
  if (!Array.isArray(results.cases) || results.cases.length !== expectedPerStratum * STRATA.length) {
    throw new Error(`Evaluation Results 必须包含 ${expectedPerStratum * STRATA.length} 个 Case。`)
  }

  const counts = { short: 0, medium: 0, long: 0 }
  const directedPairs = new Set()
  for (const item of results.cases) {
    if (!Object.hasOwn(counts, item.stratum)) throw new Error(`${item.id} Stratum 无效。`)
    counts[item.stratum] += 1
    const startId = item.start?.nodeId
    const destinationId = item.destination?.nodeId
    if (!graph.nodes.has(startId) || !graph.nodes.has(destinationId)) {
      throw new Error(`${item.id} 引用了不存在的 Node。`)
    }
    const startNode = graph.nodes.get(startId)
    const destinationNode = graph.nodes.get(destinationId)
    const coordinatesMatch = (coordinates, node) => Array.isArray(coordinates)
      && coordinates.length === 2
      && equalNumber(coordinates[0], node.lon)
      && equalNumber(coordinates[1], node.lat)
    if (!coordinatesMatch(item.start.coordinates, startNode)
      || !coordinatesMatch(item.destination.coordinates, destinationNode)) {
      throw new Error(`${item.id} 坐标与 Graph Node 不一致。`)
    }
    const pairKey = `${startId}\u0000${destinationId}`
    if (directedPairs.has(pairKey)) throw new Error(`Evaluation Results 存在重复有向 OD：${startId} → ${destinationId}`)
    directedPairs.add(pairKey)
    assertFinite(item.straightDistanceMeters, `${item.id} straightDistanceMeters`, { minimum: 350, maximum: 1800 })
    if (classifyFastestDistance(item.routes.fastest.distanceMeters) !== item.stratum) {
      throw new Error(`${item.id} Fastest Distance 与 Stratum 不一致。`)
    }
    if (item.routes.fastest.distanceMeters / item.straightDistanceMeters > 3) {
      throw new Error(`${item.id} Fastest/Straight Distance Ratio 超过 3。`)
    }
    for (const mode of MODES) {
      validateRoute(
        item.routes[mode],
        mode,
        graph,
        results.metadata.routingConfig,
        item.id,
        startId,
        destinationId,
      )
    }
    validateComparison(item, 'balanced')
    validateComparison(item, 'coolest')
    validateEquality(item)
  }
  for (const stratum of STRATA) {
    if (counts[stratum] !== expectedPerStratum) {
      throw new Error(`${stratum} Stratum 必须有 ${expectedPerStratum} 个 Case。`)
    }
    if (results.sampling.acceptedByStratum[stratum] !== expectedPerStratum) {
      throw new Error(`${stratum} Sampling Audit 与 Case 不一致。`)
    }
  }
}

export function validateEvaluationSummary(results, summary) {
  const expected = createEvaluationSummary(results)
  if (serializeJson(summary) !== serializeJson(expected)) {
    throw new Error('Evaluation Summary 与 Results 不一致。')
  }
}
