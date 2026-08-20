const ROUTING_MODES = Object.freeze(['fastest', 'balanced', 'coolest'])
const CANDIDATE_MODES = Object.freeze(['balanced', 'coolest'])
const ROUTE_METRIC_FIELDS = Object.freeze([
  'distanceMeters',
  'walkingTimeSeconds',
  'averageHeatExposure',
  'modelledExposureLoad',
  'greenIndicator',
  'waterAccessIndicator',
  'edgeCount',
])
const COMPARISON_FIELDS = Object.freeze([
  'extraDistanceMeters',
  'extraDistancePercent',
  'extraWalkingMinutes',
  'averageHeatExposureReduction',
  'averageHeatExposureReductionPercent',
  'modelledExposureLoadReduction',
  'modelledExposureLoadReductionPercent',
  'greenIndicatorChange',
  'waterAccessIndicatorChange',
])

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return null
  const position = (sortedValues.length - 1) * fraction
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex]
  const weight = position - lowerIndex
  return sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight
}

export function summarizeDistribution(values) {
  if (!Array.isArray(values)) throw new TypeError('Distribution 输入必须是数组。')
  const numericValues = []
  let nullCount = 0
  for (const value of values) {
    if (value === null) {
      nullCount += 1
    } else if (Number.isFinite(value)) {
      numericValues.push(value)
    } else {
      throw new TypeError('Distribution 只能包含有限数或 null。')
    }
  }
  numericValues.sort((first, second) => first - second)
  const count = numericValues.length
  if (count === 0) {
    return {
      count,
      nullCount,
      min: null,
      mean: null,
      median: null,
      p25: null,
      p75: null,
      p90: null,
      max: null,
    }
  }
  return {
    count,
    nullCount,
    min: numericValues[0],
    mean: numericValues.reduce((sum, value) => sum + value, 0) / count,
    median: percentile(numericValues, 0.5),
    p25: percentile(numericValues, 0.25),
    p75: percentile(numericValues, 0.75),
    p90: percentile(numericValues, 0.9),
    max: numericValues.at(-1),
  }
}

function counted(count, total) {
  return { count, rate: total === 0 ? null : count / total }
}

function equalitySummary(cases) {
  const total = cases.length
  const count = (field) => cases.filter((item) => item.routeEquality[field]).length
  const allThreeEqualCount = count('allThreeEqual')
  return {
    fastestEqualsBalanced: counted(count('fastestEqualsBalanced'), total),
    fastestEqualsCoolest: counted(count('fastestEqualsCoolest'), total),
    balancedEqualsCoolest: counted(count('balancedEqualsCoolest'), total),
    allThreeEqual: counted(allThreeEqualCount, total),
    notAllThreeEqual: counted(total - allThreeEqualCount, total),
  }
}

function metricDistributions(cases) {
  return Object.fromEntries(ROUTING_MODES.map((mode) => [
    mode,
    Object.fromEntries(ROUTE_METRIC_FIELDS.map((field) => [
      field,
      summarizeDistribution(cases.map((item) => item.routes[mode][field])),
    ])),
  ]))
}

function improvementSummary(comparisons) {
  const total = comparisons.length
  const averageReduced = comparisons.filter((item) => item.averageHeatExposureReduction > 0)
  const loadReduced = comparisons.filter((item) => item.modelledExposureLoadReduction > 0)
  const bothReduced = comparisons.filter(
    (item) => item.averageHeatExposureReduction > 0 && item.modelledExposureLoadReduction > 0,
  )
  const averageReducedLoadIncreased = comparisons.filter(
    (item) => item.averageHeatExposureReduction > 0 && item.modelledExposureLoadReduction < 0,
  )
  const neitherReduced = comparisons.filter(
    (item) => item.averageHeatExposureReduction <= 0 && item.modelledExposureLoadReduction <= 0,
  )
  return {
    averageExposureReduced: counted(averageReduced.length, total),
    loadReduced: counted(loadReduced.length, total),
    bothReduced: counted(bothReduced.length, total),
    averageReducedLoadIncreased: counted(averageReducedLoadIncreased.length, total),
    neitherReduced: counted(neitherReduced.length, total),
  }
}

function thresholdResult(comparisons, field, threshold) {
  const eligible = comparisons.filter((item) => item[field] <= threshold)
  const averageReduced = eligible.filter((item) => item.averageHeatExposureReduction > 0)
  const loadReduced = eligible.filter((item) => item.modelledExposureLoadReduction > 0)
  const bothReduced = eligible.filter(
    (item) => item.averageHeatExposureReduction > 0 && item.modelledExposureLoadReduction > 0,
  )
  const eligibleCount = eligible.length
  const withinEligible = (count) => eligibleCount === 0 ? null : count / eligibleCount
  return {
    threshold,
    eligibleCount,
    eligibleRateOfAllSamples: comparisons.length === 0 ? null : eligibleCount / comparisons.length,
    averageExposureReducedCount: averageReduced.length,
    averageExposureReducedRateWithinEligible: withinEligible(averageReduced.length),
    loadReducedCount: loadReduced.length,
    loadReducedRateWithinEligible: withinEligible(loadReduced.length),
    bothReducedCount: bothReduced.length,
    bothReducedRateWithinEligible: withinEligible(bothReduced.length),
  }
}

function detourThresholds(comparisons) {
  return {
    extraDistancePercent: Object.fromEntries(
      [5, 10, 15, 25].map((threshold) => [
        `le${threshold}`,
        thresholdResult(comparisons, 'extraDistancePercent', threshold),
      ]),
    ),
    extraWalkingMinutes: Object.fromEntries(
      [1, 3, 5].map((threshold) => [
        `le${threshold}`,
        thresholdResult(comparisons, 'extraWalkingMinutes', threshold),
      ]),
    ),
  }
}

function comparisonSummary(cases, mode) {
  const comparisons = cases.map((item) => item.comparisons[mode])
  return {
    improvements: improvementSummary(comparisons),
    distributions: Object.fromEntries(COMPARISON_FIELDS.map((field) => [
      field,
      summarizeDistribution(comparisons.map((item) => item[field])),
    ])),
    detourThresholds: detourThresholds(comparisons),
  }
}

export function createEvaluationSummary(results) {
  const cases = results?.cases
  if (!Array.isArray(cases)) throw new TypeError('Evaluation Results 缺少 cases。')
  const countsByStratum = { short: 0, medium: 0, long: 0 }
  for (const item of cases) {
    if (Object.hasOwn(countsByStratum, item.stratum)) countsByStratum[item.stratum] += 1
  }
  return {
    metadata: {
      evaluationSchemaVersion: results.metadata.evaluationSchemaVersion,
      graphSchemaVersion: results.metadata.graphSchemaVersion,
      graphSha256: results.metadata.graphSha256,
      graphNodeCount: results.metadata.graphNodeCount,
      graphEdgeCount: results.metadata.graphEdgeCount,
      demoArea: results.metadata.demoArea,
      seed: results.metadata.seed,
      samplingRules: results.metadata.samplingRules,
      routingConfig: results.metadata.routingConfig,
      edgeScoresModified: results.metadata.edgeScoresModified,
      routingAlgorithmModified: results.metadata.routingAlgorithmModified,
      exposureFormulaModified: results.metadata.exposureFormulaModified,
    },
    samples: {
      totalCount: cases.length,
      countsByStratum,
      attempts: results.sampling.attempts,
      rejectionCounts: results.sampling.rejectionCounts,
    },
    routeEquality: equalitySummary(cases),
    routeMetrics: metricDistributions(cases),
    comparisons: Object.fromEntries(
      CANDIDATE_MODES.map((mode) => [mode, comparisonSummary(cases, mode)]),
    ),
  }
}
