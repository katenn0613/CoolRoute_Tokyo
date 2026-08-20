import { describe, expect, it } from 'vitest'

import {
  createEvaluationSummary,
  summarizeDistribution,
} from '../../scripts/evaluation/summary.mjs'

function routeMetrics(overrides = {}) {
  return {
    mode: 'fastest',
    distanceMeters: 1000,
    walkingTimeSeconds: 700,
    edgeCount: 4,
    averageHeatExposure: 0.6,
    modelledExposureLoad: 600,
    greenIndicator: 0.2,
    waterAccessIndicator: 0.4,
    totalCost: 1000,
    edgeIds: ['e1'],
    ...overrides,
  }
}

function comparison(overrides = {}) {
  return {
    extraDistanceMeters: 40,
    extraDistancePercent: 4,
    extraWalkingMinutes: 0.5,
    averageHeatExposureChange: -0.1,
    averageHeatExposureReduction: 0.1,
    averageHeatExposureReductionPercent: 100 / 6,
    modelledExposureLoadChange: -20,
    modelledExposureLoadReduction: 20,
    modelledExposureLoadReductionPercent: 100 / 30,
    greenIndicatorChange: 0.1,
    waterAccessIndicatorChange: 0.05,
    ...overrides,
  }
}

function evaluationCase(id, stratum, overrides = {}) {
  return {
    id,
    stratum,
    routes: {
      fastest: routeMetrics(),
      balanced: routeMetrics({ mode: 'balanced', distanceMeters: 1040 }),
      coolest: routeMetrics({ mode: 'coolest', distanceMeters: 1100 }),
    },
    comparisons: {
      balanced: comparison(),
      coolest: comparison({ extraDistanceMeters: 100, extraDistancePercent: 10 }),
    },
    routeEquality: {
      fastestEqualsBalanced: false,
      fastestEqualsCoolest: false,
      balancedEqualsCoolest: false,
      allThreeEqual: false,
    },
    ...overrides,
  }
}

function resultsFixture() {
  return {
    metadata: {
      evaluationSchemaVersion: '1.0.0',
      graphSha256: 'abc123',
      seed: 20260821,
      routingConfig: { balancedLambda: 1, coolestLambda: 3 },
    },
    sampling: {
      attempts: 12,
      acceptedByStratum: { short: 1, medium: 1, long: 1 },
      rejectionCounts: { sameNode: 2 },
    },
    cases: [
      evaluationCase('m7-od-001', 'short'),
      evaluationCase('m7-od-002', 'medium', {
        comparisons: {
          balanced: comparison({
            extraDistanceMeters: 80,
            extraDistancePercent: 8,
            extraWalkingMinutes: 2,
            averageHeatExposureReduction: 0.05,
            modelledExposureLoadReduction: -10,
          }),
          coolest: comparison({
            extraDistanceMeters: 200,
            extraDistancePercent: 20,
            extraWalkingMinutes: 4,
            averageHeatExposureReduction: 0,
            modelledExposureLoadReduction: 0,
            averageHeatExposureReductionPercent: null,
          }),
        },
        routeEquality: {
          fastestEqualsBalanced: true,
          fastestEqualsCoolest: false,
          balancedEqualsCoolest: false,
          allThreeEqual: false,
        },
      }),
      evaluationCase('m7-od-003', 'long', {
        comparisons: {
          balanced: comparison({
            extraDistanceMeters: 300,
            extraDistancePercent: 30,
            extraWalkingMinutes: 6,
            averageHeatExposureReduction: -0.01,
            modelledExposureLoadReduction: -30,
          }),
          coolest: comparison({
            extraDistanceMeters: 300,
            extraDistancePercent: 30,
            extraWalkingMinutes: 6,
            averageHeatExposureReduction: -0.01,
            modelledExposureLoadReduction: 5,
          }),
        },
        routeEquality: {
          fastestEqualsBalanced: true,
          fastestEqualsCoolest: true,
          balancedEqualsCoolest: true,
          allThreeEqual: true,
        },
      }),
    ],
  }
}

describe('M7 evaluation summary', () => {
  it('uses linear interpolation and excludes null from distributions', () => {
    const distribution = summarizeDistribution([0, 10, 20, 30, null])
    expect(distribution).toMatchObject({
      count: 4,
      nullCount: 1,
      min: 0,
      mean: 15,
      median: 15,
      p25: 7.5,
      p75: 22.5,
      max: 30,
    })
    expect(distribution.p90).toBeCloseTo(27)
  })

  it('rejects non-finite numbers instead of allowing NaN to spread', () => {
    expect(() => summarizeDistribution([1, Number.NaN])).toThrow(/有限数或 null/)
    expect(() => summarizeDistribution([Number.POSITIVE_INFINITY])).toThrow(/有限数或 null/)
  })

  it('counts equality and improvements without treating zero or negative reductions as improvement', () => {
    const summary = createEvaluationSummary(resultsFixture())
    expect(summary.samples).toMatchObject({
      totalCount: 3,
      countsByStratum: { short: 1, medium: 1, long: 1 },
      attempts: 12,
    })
    expect(summary.routeEquality.fastestEqualsBalanced).toEqual({ count: 2, rate: 2 / 3 })
    expect(summary.routeEquality.allThreeEqual).toEqual({ count: 1, rate: 1 / 3 })
    expect(summary.comparisons.balanced.improvements).toEqual({
      averageExposureReduced: { count: 2, rate: 2 / 3 },
      loadReduced: { count: 1, rate: 1 / 3 },
      bothReduced: { count: 1, rate: 1 / 3 },
      averageReducedLoadIncreased: { count: 1, rate: 1 / 3 },
      neitherReduced: { count: 1, rate: 1 / 3 },
    })
    expect(summary.comparisons.coolest.improvements.loadReduced.count).toBe(2)
    expect(summary.comparisons.coolest.improvements.averageExposureReduced.count).toBe(1)
  })

  it('uses eligible samples as every detour-threshold rate denominator', () => {
    const summary = createEvaluationSummary(resultsFixture())
    expect(summary.comparisons.balanced.detourThresholds.extraDistancePercent.le5).toEqual({
      threshold: 5,
      eligibleCount: 1,
      eligibleRateOfAllSamples: 1 / 3,
      averageExposureReducedCount: 1,
      averageExposureReducedRateWithinEligible: 1,
      loadReducedCount: 1,
      loadReducedRateWithinEligible: 1,
      bothReducedCount: 1,
      bothReducedRateWithinEligible: 1,
    })
    expect(summary.comparisons.balanced.detourThresholds.extraDistancePercent.le10).toMatchObject({
      eligibleCount: 2,
      averageExposureReducedCount: 2,
      averageExposureReducedRateWithinEligible: 1,
      loadReducedCount: 1,
      loadReducedRateWithinEligible: 0.5,
      bothReducedRateWithinEligible: 0.5,
    })
    expect(summary.comparisons.balanced.detourThresholds.extraWalkingMinutes.le1.eligibleCount).toBe(1)
    expect(summary.comparisons.balanced.detourThresholds.extraWalkingMinutes.le3.eligibleCount).toBe(2)
  })
})
