import { describe, expect, it } from 'vitest'
import {
  compareRouteToFastest,
  compareShadeAwareRouteToFastest,
  passesDetourGuard,
} from '../../src/routing/routeComparison.js'

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

  it('keeps Shade-aware comparison separate from the M5 comparison contract', () => {
    const fastest = {
      distanceMeters: 1000,
      walkingTimeSeconds: 700,
      averageHeatExposure: 0.6,
      modelledExposureLoad: 600,
      shadeAwareAverageHeatExposure: 0.5,
      shadeAwareExposureLoad: 500,
    }
    const candidate = {
      distanceMeters: 1100,
      walkingTimeSeconds: 760,
      averageHeatExposure: 0.55,
      modelledExposureLoad: 605,
      shadeAwareAverageHeatExposure: 0.4,
      shadeAwareExposureLoad: 440,
    }
    expect(Object.keys(compareRouteToFastest(candidate, fastest))).not.toContain('shadeAwareExposureChange')
    const comparison = compareShadeAwareRouteToFastest(candidate, fastest)
    expect(comparison.shadeAwareExposureChange).toBeCloseTo(-0.1)
    expect(comparison.shadeAwareExposureReductionPercent).toBeCloseTo(20)
    expect(comparison.shadeAwareLoadChange).toBe(-60)
    expect(comparison.shadeAwareLoadReductionPercent).toBeCloseTo(12)
  })
})
