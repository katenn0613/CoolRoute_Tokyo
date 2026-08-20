import { describe, expect, it } from 'vitest'
import { prepareGraph } from '../../src/routing/graphLoader.js'
import { buildShadeFeatureCollection } from '../../src/shade/shadeLayer.js'

const graph = prepareGraph({
  metadata: { graphVersion: '1.1.0', generatedAt: 'graph-time', nodeCount: 2, edgeCount: 1 },
  nodes: {
    a: { id: 'a', lon: 139.75, lat: 35.68 },
    b: { id: 'b', lon: 139.751, lat: 35.681 },
  },
  edges: [{
    id: 'a:b:0', source: 'a', target: 'b', length: 100,
    geometry: [[139.75, 35.68], [139.751, 35.681]], green_score: 0.2, water_penalty: 0.3,
  }],
})

const shade = {
  metadata: { scenarios: ['09:00', '12:00', '15:00'] },
  edgeShadeScores: { 'a:b:0': [0.1, 0.5, 0.9] },
}

describe('Shade GeoJSON layer builder', () => {
  it('joins selected scenario score to unchanged production edge geometry', () => {
    const result = buildShadeFeatureCollection(graph, shade, '15:00')

    expect(result.features).toHaveLength(1)
    expect(result.features[0].properties).toEqual({
      edgeId: 'a:b:0', shadeScore: 0.9, scenario: '15:00',
    })
    expect(result.features[0].geometry.coordinates).toBe(graph.edges.get('a:b:0').geometry)
  })

  it('rejects a scenario outside the sidecar contract', () => {
    expect(() => buildShadeFeatureCollection(graph, shade, '18:00')).toThrow(/18:00/)
  })
})
