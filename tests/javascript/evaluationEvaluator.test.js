import { describe, expect, it } from 'vitest'

import {
  createEvaluationCase,
  sameEdgeSequence,
} from '../../scripts/evaluation/evaluator.mjs'

function route(mode, edgeIds, metrics, totalCost, calculationTimeMs = 3) {
  return {
    mode,
    result: {
      edgeSequence: edgeIds.map((id) => ({ id })),
      totalCost,
      nodeSequence: ['a', 'b'],
    },
    metrics,
    geoJSON: { type: 'Feature' },
    calculationTimeMs,
  }
}

const fastestMetrics = {
  distanceMeters: 500,
  walkingTimeSeconds: 500 / 1.4,
  edgeCount: 2,
  averageHeatExposure: 0.6,
  modelledExposureLoad: 300,
  greenIndicator: 0.2,
  waterAccessIndicator: 0.4,
}

const balancedMetrics = {
  distanceMeters: 525,
  walkingTimeSeconds: 375,
  edgeCount: 2,
  averageHeatExposure: 0.55,
  modelledExposureLoad: 288.75,
  greenIndicator: 0.3,
  waterAccessIndicator: 0.45,
}

const coolestMetrics = {
  distanceMeters: 550,
  walkingTimeSeconds: 550 / 1.4,
  edgeCount: 3,
  averageHeatExposure: 0.5,
  modelledExposureLoad: 275,
  greenIndicator: 0.4,
  waterAccessIndicator: 0.5,
}

const comparison = {
  extraDistanceMeters: 25,
  extraDistancePercent: 5,
  extraWalkingMinutes: 25 / 1.4 / 60,
  averageHeatExposureChange: -0.05,
  averageHeatExposureReduction: 0.05,
  averageHeatExposureReductionPercent: 100 / 12,
  modelledExposureLoadChange: -11.25,
  modelledExposureLoadReduction: 11.25,
  modelledExposureLoadReductionPercent: 3.75,
}

function bundleFixture() {
  return {
    routes: {
      fastest: route('fastest', ['e1', 'e2'], fastestMetrics, 500),
      balanced: route('balanced', ['e1', 'e2'], balancedMetrics, 813.75),
      coolest: route('coolest', ['e3', 'e4', 'e5'], coolestMetrics, 1375),
    },
    comparisons: {
      balanced: comparison,
      coolest: {
        ...comparison,
        extraDistanceMeters: 50,
        extraDistancePercent: 10,
        averageHeatExposureReduction: 0.1,
        modelledExposureLoadReduction: 25,
      },
    },
    totalCalculationTimeMs: 12,
  }
}

describe('M7 per-OD evaluation record', () => {
  it('compares complete ordered Edge ID sequences', () => {
    expect(sameEdgeSequence(
      { result: { edgeSequence: [{ id: 'e1' }, { id: 'e2' }] } },
      { result: { edgeSequence: [{ id: 'e1' }, { id: 'e2' }] } },
    )).toBe(true)
    expect(sameEdgeSequence(
      { result: { edgeSequence: [{ id: 'e1' }, { id: 'e2' }] } },
      { result: { edgeSequence: [{ id: 'e2' }, { id: 'e1' }] } },
    )).toBe(false)
  })

  it('serializes only approved route metrics and comparisons', () => {
    const record = createEvaluationCase({
      index: 1,
      stratum: 'short',
      start: { id: 'a', lon: 139.75, lat: 35.68 },
      destination: { id: 'b', lon: 139.76, lat: 35.69 },
      straightDistanceMeters: 487.25,
      bundle: bundleFixture(),
    })

    expect(record).toMatchObject({
      id: 'm7-od-001',
      stratum: 'short',
      start: { nodeId: 'a', coordinates: [139.75, 35.68] },
      destination: { nodeId: 'b', coordinates: [139.76, 35.69] },
      straightDistanceMeters: 487.25,
      routes: {
        fastest: {
          mode: 'fastest',
          distanceMeters: 500,
          walkingTimeSeconds: 500 / 1.4,
          edgeCount: 2,
          averageHeatExposure: 0.6,
          modelledExposureLoad: 300,
          greenIndicator: 0.2,
          waterAccessIndicator: 0.4,
          totalCost: 500,
          edgeIds: ['e1', 'e2'],
        },
      },
      comparisons: {
        balanced: {
          ...comparison,
        },
      },
      routeEquality: {
        fastestEqualsBalanced: true,
        fastestEqualsCoolest: false,
        balancedEqualsCoolest: false,
        allThreeEqual: false,
      },
    })
    expect(record.routes.fastest).not.toHaveProperty('calculationTimeMs')
    expect(record.routes.fastest).not.toHaveProperty('geoJSON')
    expect(record).not.toHaveProperty('totalCalculationTimeMs')
    expect(record.comparisons.balanced.greenIndicatorChange).toBeCloseTo(0.1)
    expect(record.comparisons.balanced.waterAccessIndicatorChange).toBeCloseTo(0.05)
  })
})
