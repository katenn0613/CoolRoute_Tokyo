import { describe, expect, it } from 'vitest'

import {
  normalizeForOutput,
  renderJapaneseSummary,
  serializeJson,
} from '../../scripts/evaluation/serializer.mjs'

function distribution(mean) {
  return {
    count: 90,
    nullCount: 0,
    min: mean,
    mean,
    median: mean,
    p25: mean,
    p75: mean,
    p90: mean,
    max: mean,
  }
}

function threshold(thresholdValue) {
  return {
    threshold: thresholdValue,
    eligibleCount: 60,
    eligibleRateOfAllSamples: 2 / 3,
    averageExposureReducedCount: 30,
    averageExposureReducedRateWithinEligible: 0.5,
    loadReducedCount: 20,
    loadReducedRateWithinEligible: 1 / 3,
    bothReducedCount: 15,
    bothReducedRateWithinEligible: 0.25,
  }
}

function summaryFixture() {
  const routeDistribution = {
    distanceMeters: distribution(1000),
    walkingTimeSeconds: distribution(714.285714285714),
    averageHeatExposure: distribution(0.6),
    modelledExposureLoad: distribution(600),
    greenIndicator: distribution(0.2),
    waterAccessIndicator: distribution(0.4),
    edgeCount: distribution(8),
  }
  const candidate = {
    improvements: {
      averageExposureReduced: { count: 45, rate: 0.5 },
      loadReduced: { count: 30, rate: 1 / 3 },
      bothReduced: { count: 25, rate: 25 / 90 },
      averageReducedLoadIncreased: { count: 15, rate: 1 / 6 },
      neitherReduced: { count: 40, rate: 4 / 9 },
    },
    distributions: {
      extraDistanceMeters: distribution(80),
      extraDistancePercent: distribution(8),
      extraWalkingMinutes: distribution(1),
      averageHeatExposureReduction: distribution(0.05),
      averageHeatExposureReductionPercent: distribution(8),
      modelledExposureLoadReduction: distribution(20),
      modelledExposureLoadReductionPercent: distribution(3),
      greenIndicatorChange: distribution(0.02),
      waterAccessIndicatorChange: distribution(0.01),
    },
    detourThresholds: {
      extraDistancePercent: {
        le5: threshold(5),
        le10: threshold(10),
        le15: threshold(15),
        le25: threshold(25),
      },
      extraWalkingMinutes: {
        le1: threshold(1),
        le3: threshold(3),
        le5: threshold(5),
      },
    },
  }
  return {
    metadata: {
      evaluationSchemaVersion: '1.0.0',
      graphSha256: 'abc123',
      seed: 20260821,
      demoArea: { id: 'demo', name: '皇居东侧—丸之内—东京站' },
      routingConfig: { balancedLambda: 1, coolestLambda: 3 },
    },
    samples: {
      totalCount: 90,
      countsByStratum: { short: 30, medium: 30, long: 30 },
      attempts: 500,
      rejectionCounts: {},
    },
    routeEquality: {
      fastestEqualsBalanced: { count: 50, rate: 5 / 9 },
      fastestEqualsCoolest: { count: 40, rate: 4 / 9 },
      balancedEqualsCoolest: { count: 45, rate: 0.5 },
      allThreeEqual: { count: 35, rate: 35 / 90 },
      notAllThreeEqual: { count: 55, rate: 55 / 90 },
    },
    routeMetrics: {
      fastest: routeDistribution,
      balanced: routeDistribution,
      coolest: routeDistribution,
    },
    comparisons: { balanced: candidate, coolest: candidate },
  }
}

describe('M7 deterministic serializer', () => {
  it('normalizes finite floats to 12 decimals and converts negative zero', () => {
    expect(normalizeForOutput({ value: 1.1234567890126, negativeZero: -0 })).toEqual({
      value: 1.123456789013,
      negativeZero: 0,
    })
  })

  it('rejects NaN and Infinity instead of emitting invalid JSON', () => {
    expect(() => normalizeForOutput({ value: Number.NaN })).toThrow(/有限数/)
    expect(() => normalizeForOutput([Number.POSITIVE_INFINITY])).toThrow(/有限数/)
  })

  it('emits stable two-space JSON with a final newline', () => {
    const value = { z: 1 / 3, nested: { a: null } }
    const first = serializeJson(value)
    expect(first).toBe(`${JSON.stringify(normalizeForOutput(value), null, 2)}\n`)
    expect(serializeJson(value)).toBe(first)
  })

  it('renders a deterministic Japanese report with scoped non-medical language', () => {
    const first = renderJapaneseSummary(summaryFixture())
    expect(renderJapaneseSummary(summaryFixture())).toBe(first)
    expect(first).toContain('平均暑さ曝露スコア')
    expect(first).toContain('モデル上の累積暑さ曝露')
    expect(first).toContain('90 組')
    expect(first).toContain('現在の Demo Area')
    expect(first).toContain('医療リスクや熱中症確率を示すものではありません')
    expect(first).not.toContain('/Users/')
  })
})
