import { describe, expect, it } from 'vitest'
import { buildExposureFeatureCollection } from '../../src/routing/exposureLayer.js'

describe('M6 Heat Exposure Layer', () => {
  it('uses the official M5 model and preserves every production edge geometry', () => {
    const geometry = [[139.75, 35.68], [139.751, 35.681]]
    const edge = {
      id: 'a:b:0', source: 'a', target: 'b', length: 120,
      green_score: 0.25, water_penalty: 0.5, geometry,
    }
    const graph = { edges: new Map([[edge.id, edge]]) }

    const result = buildExposureFeatureCollection(graph, { greenWeight: 1, waterWeight: 0 })

    expect(result).toEqual({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        id: 'a:b:0',
        properties: { edgeId: 'a:b:0', heatExposure: 0.75 },
        geometry: { type: 'LineString', coordinates: geometry },
      }],
    })
  })

  it('rejects a value that is not a prepared Road Graph', () => {
    expect(() => buildExposureFeatureCollection({ edges: [] })).toThrow(/Map/)
  })
})
