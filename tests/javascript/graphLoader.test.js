import { describe, expect, it, vi } from 'vitest'
import {
  GraphLoadError,
  GraphSchemaError,
  loadRoadGraph,
  prepareGraph,
} from '../../src/routing/graphLoader.js'

function validPayload() {
  return {
    metadata: {
      graphVersion: '1.0.0',
      nodeCount: 3,
      edgeCount: 3,
    },
    nodes: {
      a: { id: 'a', lon: 139.75, lat: 35.68 },
      b: { id: 'b', lon: 139.751, lat: 35.681 },
      c: { id: 'c', lon: 139.752, lat: 35.682 },
    },
    edges: [
      {
        id: 'a:b:slow',
        source: 'a',
        target: 'b',
        length: 10,
        geometry: [[139.75, 35.68], [139.751, 35.681]],
      },
      {
        id: 'a:b:fast',
        source: 'a',
        target: 'b',
        length: 7,
        geometry: [[139.75, 35.68], [139.751, 35.681]],
      },
      {
        id: 'b:c:0',
        source: 'b',
        target: 'c',
        length: 5,
        geometry: [[139.751, 35.681], [139.752, 35.682]],
      },
    ],
  }
}

describe('Graph Loader', () => {
  it('uses a GitHub Pages compatible asset URL and prepares MultiEdge adjacency', async () => {
    const payload = validPayload()
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => payload,
    }))

    const result = await loadRoadGraph({ fetchImpl })

    const requestedUrl = fetchImpl.mock.calls[0][0]
    expect(requestedUrl).toMatch(/data\/graph_tokyo_core5\.json$/)
    expect(requestedUrl).not.toContain('localhost')
    expect(result.loadTimeMs).toBeGreaterThanOrEqual(0)
    expect(result.graph.nodes).toBeInstanceOf(Map)
    expect(result.graph.edges).toBeInstanceOf(Map)
    expect(result.graph.adjacency.get('a').map((edge) => edge.id)).toEqual([
      'a:b:slow',
      'a:b:fast',
    ])
  })

  it('rejects an edge whose target node does not exist', () => {
    const payload = validPayload()
    payload.edges[0].target = 'missing'

    expect(() => prepareGraph(payload)).toThrow(GraphSchemaError)
  })

  it('rejects metadata counts that disagree with graph content', () => {
    const payload = validPayload()
    payload.metadata.edgeCount = 99

    expect(() => prepareGraph(payload)).toThrow(/Edge 数量/)
  })

  it('accepts Schema 1.1.0 environment edge fields', () => {
    const payload = validPayload()
    payload.metadata.graphVersion = '1.1.0'
    payload.edges.forEach((edge) => Object.assign(edge, {
      green_score: 0.25,
      water_penalty: 0.3,
    }))

    expect(prepareGraph(payload).metadata.graphVersion).toBe('1.1.0')
  })

  it('rejects invalid Schema 1.1.0 environment values', () => {
    const payload = validPayload()
    payload.metadata.graphVersion = '1.1.0'
    payload.edges.forEach((edge) => Object.assign(edge, {
      green_score: 1.5,
      water_penalty: 0.3,
    }))

    expect(() => prepareGraph(payload)).toThrow(/green_score/)
  })

  it.each([
    ['缺少字段', undefined, 0.3],
    ['NaN', Number.NaN, 0.3],
    ['Infinity', 0.2, Number.POSITIVE_INFINITY],
    ['penalty 越界', 0.2, -0.1],
  ])('rejects Schema 1.1.0 %s', (_name, greenScore, penalty) => {
    const payload = validPayload()
    payload.metadata.graphVersion = '1.1.0'
    payload.edges.forEach((edge) => Object.assign(edge, {
      green_score: greenScore,
      water_penalty: penalty,
    }))
    expect(() => prepareGraph(payload)).toThrow(GraphSchemaError)
  })

  it.each([
    ['反向', [[139.751, 35.681], [139.75, 35.68]]],
    ['偏移', [[139.7505, 35.6805], [139.751, 35.681]]],
  ])('rejects %s geometry that does not follow source to target', (_name, geometry) => {
    const payload = validPayload()
    payload.edges[0].geometry = geometry

    expect(() => prepareGraph(payload)).toThrow(/source → target/)
  })

  it('reports an HTTP failure as a graph loading error', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }))

    await expect(loadRoadGraph({ fetchImpl, url: '/missing.json' })).rejects.toBeInstanceOf(
      GraphLoadError,
    )
  })
})
