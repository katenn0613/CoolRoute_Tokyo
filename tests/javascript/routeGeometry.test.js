import { describe, expect, it } from 'vitest'
import { findShortestPath } from '../../src/routing/dijkstra.js'
import { RouteGeometryError, buildRouteGeoJSON } from '../../src/routing/routeGeometry.js'
import { calculateRouteMetrics } from '../../src/routing/routeMetrics.js'
import { createSyntheticRoadGraph } from './fixtures/syntheticRoadGraph.js'

describe('Route geometry and metrics', () => {
  it('joins real edge geometry while keeping intermediate road-shape points', () => {
    const route = findShortestPath(createSyntheticRoadGraph(), 'a', 'd')

    const feature = buildRouteGeoJSON(route.edgeSequence)

    expect(feature).toEqual({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [139.75, 35.68],
          [139.7505, 35.6805],
          [139.751, 35.681],
          [139.752, 35.6815],
          [139.753, 35.682],
        ],
      },
    })
  })

  it('calculates distance, walking time and edge count from one speed configuration', () => {
    const route = findShortestPath(createSyntheticRoadGraph(), 'a', 'd')

    expect(calculateRouteMetrics(route.edgeSequence, 1.4)).toEqual({
      distanceMeters: 7,
      walkingTimeSeconds: 5,
      edgeCount: 2,
      averageHeatExposure: 1,
      modelledExposureLoad: 7,
      greenIndicator: 0,
      waterAccessIndicator: 0,
    })
  })

  it('rejects an edge sequence whose graph topology is discontinuous', () => {
    const graph = createSyntheticRoadGraph()
    const edges = [graph.edges.get('a:b:fast'), graph.edges.get('c:d:0')]

    expect(() => buildRouteGeoJSON(edges)).toThrow(RouteGeometryError)
  })

  it('returns no LineString for a zero-edge same-node route', () => {
    expect(buildRouteGeoJSON([])).toBeNull()
  })
})
