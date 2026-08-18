import { describe, expect, it } from 'vitest'
import { calculateRouteMetrics } from '../../src/routing/routeMetrics.js'

const edge = (length, greenScore, waterPenalty) => ({
  id: `${length}:${greenScore}:${waterPenalty}`,
  length,
  green_score: greenScore,
  water_penalty: waterPenalty,
})

describe('M5 Route Exposure Metrics', () => {
  it('separates distance-weighted average exposure from cumulative exposure load', () => {
    const metrics = calculateRouteMetrics([edge(100, 1, 0), edge(300, 0, 1)], 2)
    // exposure: first 0, second 1
    expect(metrics.averageHeatExposure).toBeCloseTo(0.75)
    expect(metrics.modelledExposureLoad).toBeCloseTo(300)
    expect(metrics.greenIndicator).toBeCloseTo(0.25)
    expect(metrics.waterAccessIndicator).toBeCloseTo(0.25)
    expect(metrics.walkingTimeSeconds).toBe(200)
  })

  it('returns neutral bounded averages for a zero-edge route', () => {
    expect(calculateRouteMetrics([], 1.4)).toMatchObject({
      distanceMeters: 0,
      averageHeatExposure: 0,
      modelledExposureLoad: 0,
      greenIndicator: 0,
      waterAccessIndicator: 0,
    })
  })
})
