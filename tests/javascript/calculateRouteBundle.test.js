import { describe, expect, it } from 'vitest'
import { calculateRouteBundle } from '../../src/routing/calculateRouteBundle.js'
import { ROUTING_MODES } from '../../src/routing/exposureModel.js'
import { createSyntheticRoadGraph } from './fixtures/syntheticRoadGraph.js'

describe('M5 three-mode route bundle', () => {
  it('calculates all modes with one shared result contract', () => {
    const bundle = calculateRouteBundle(createSyntheticRoadGraph(), 'a', 'd')
    expect(Object.keys(bundle.routes)).toEqual(Object.values(ROUTING_MODES))
    expect(bundle.routes.fastest.metrics.distanceMeters).toBe(7)
    expect(bundle.routes.coolest.metrics.distanceMeters).toBe(14)
    expect(bundle.routes.fastest.geoJSON.geometry.type).toBe('LineString')
    expect(bundle.comparisons.coolest.extraDistanceMeters).toBe(7)
    expect(bundle.totalCalculationTimeMs).toBeGreaterThanOrEqual(0)
  })

  it('keeps lambda zero mode equivalent to Fastest', () => {
    const bundle = calculateRouteBundle(createSyntheticRoadGraph(), 'a', 'd', {
      balancedLambda: 0,
    })
    expect(bundle.routes.balanced.result.edgeSequence.map((edge) => edge.id)).toEqual(
      bundle.routes.fastest.result.edgeSequence.map((edge) => edge.id),
    )
  })
})
