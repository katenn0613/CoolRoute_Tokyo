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

  it('injects Shade only into Balanced/Coolest and keeps comparisons compatible', () => {
    const graph = createSyntheticRoadGraph()
    const scoreByEdgeId = new Map([...graph.edges.keys()].map((edgeId) => [
      edgeId,
      edgeId === 'a:b:fast' || edgeId === 'b:d:0' ? 1 : 0,
    ]))
    const shadeContext = {
      scenario: '12:00',
      shadeWeight: 0.25,
      scoreByEdgeId: { get: (edgeId) => scoreByEdgeId.get(edgeId) },
    }
    const base = calculateRouteBundle(graph, 'a', 'd')
    const shaded = calculateRouteBundle(graph, 'a', 'd', {}, shadeContext)

    expect(shaded.routes.fastest.result.edgeSequence.map((edge) => edge.id)).toEqual(
      base.routes.fastest.result.edgeSequence.map((edge) => edge.id),
    )
    expect(shaded.routes.fastest.result.totalCost).toBe(base.routes.fastest.result.totalCost)
    expect(shaded.routes.balanced.metrics.shadeScenario).toBe('12:00')
    expect(shaded.comparisons.balanced).toEqual(
      expect.objectContaining({ extraDistanceMeters: expect.any(Number) }),
    )
    expect(shaded.comparisons.balanced).not.toHaveProperty('shadeAwareExposureChange')
    expect(shaded.shadeAwareComparisons.balanced).toEqual(
      expect.objectContaining({ shadeAwareExposureChange: expect.any(Number) }),
    )
  })
})
