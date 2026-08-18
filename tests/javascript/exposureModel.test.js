import { describe, expect, it } from 'vitest'
import {
  ROUTING_MODES,
  calculateEdgeHeatExposure,
  createEdgeWeightFunction,
} from '../../src/routing/exposureModel.js'

const edge = (overrides = {}) => ({
  id: 'edge', length: 100, green_score: 0.5, water_penalty: 0.2, ...overrides,
})

describe('M5 Edge Heat Exposure 与 Cost Model', () => {
  it('uses the configured 0.7 green and 0.3 water formula', () => {
    expect(calculateEdgeHeatExposure(edge())).toBeCloseTo(0.41)
  })

  it('keeps exposure and all mode costs finite and non-negative', () => {
    for (const candidate of [edge({ green_score: 0, water_penalty: 1 }), edge({ green_score: 1, water_penalty: 0 })]) {
      const exposure = calculateEdgeHeatExposure(candidate)
      expect(exposure).toBeGreaterThanOrEqual(0)
      expect(exposure).toBeLessThanOrEqual(1)
      for (const mode of Object.values(ROUTING_MODES)) {
        expect(createEdgeWeightFunction(mode)(candidate)).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('lambda zero is exactly distance-only', () => {
    const weight = createEdgeWeightFunction(ROUTING_MODES.BALANCED, { balancedLambda: 0 })
    expect(weight(edge())).toBe(100)
  })

  it.each([
    ['missing', { green_score: undefined }],
    ['NaN', { green_score: Number.NaN }],
    ['Infinity', { water_penalty: Number.POSITIVE_INFINITY }],
    ['out of range', { water_penalty: 1.1 }],
  ])('rejects %s environment input without fallback', (_name, overrides) => {
    expect(() => calculateEdgeHeatExposure(edge(overrides))).toThrow(/green_score|water_penalty/)
  })
})
