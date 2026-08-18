import { describe, expect, it } from 'vitest'
import { compareRouteToFastest, passesDetourGuard } from '../../src/routing/routeComparison.js'

describe('M5 Route Comparison', () => {
  it('distinguishes lower average exposure from increased cumulative load', () => {
    const fastest = { distanceMeters: 1000, walkingTimeSeconds: 700, averageHeatExposure: 0.6, modelledExposureLoad: 600 }
    const candidate = { distanceMeters: 1500, walkingTimeSeconds: 1050, averageHeatExposure: 0.45, modelledExposureLoad: 675 }
    const comparison = compareRouteToFastest(candidate, fastest)
    expect(comparison.averageHeatExposureReductionPercent).toBeCloseTo(25)
    expect(comparison.modelledExposureLoadReduction).toBe(-75)
    expect(comparison.modelledExposureLoadReductionPercent).toBeCloseTo(-12.5)
  })

  it('returns null percentages when the Fastest baseline is zero', () => {
    const base = { distanceMeters: 0, walkingTimeSeconds: 0, averageHeatExposure: 0, modelledExposureLoad: 0 }
    expect(compareRouteToFastest(base, base)).toMatchObject({
      extraDistancePercent: null,
      averageHeatExposureReductionPercent: null,
      modelledExposureLoadReductionPercent: null,
    })
  })

  it('defines 0.25 detour as at most 25 percent extra distance and null as disabled', () => {
    expect(passesDetourGuard(99999, 1000, null)).toBe(true)
    expect(passesDetourGuard(1250, 1000, 0.25)).toBe(true)
    expect(passesDetourGuard(1250.01, 1000, 0.25)).toBe(false)
  })
})
