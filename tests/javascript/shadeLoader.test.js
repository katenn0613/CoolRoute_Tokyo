import { describe, expect, it, vi } from 'vitest'
import { prepareGraph } from '../../src/routing/graphLoader.js'
import {
  ShadeSchemaError,
  loadShadeData,
  validateShadePayload,
} from '../../src/shade/shadeLoader.js'

function graph() {
  return prepareGraph({
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
}

function payload() {
  return {
    metadata: {
      schemaVersion: '1.0.0', roadGraphSchemaVersion: '1.1.0',
      roadGraphGeneratedAt: 'graph-time', edgeCount: 1,
      scenarios: ['09:00', '12:00', '15:00'],
    },
    edgeShadeScores: { 'a:b:0': [0.1, 0.5, 0.9] },
  }
}

describe('Shade static data loader', () => {
  it('defaults to the Core5 GitHub Pages asset', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => payload() })

    await loadShadeData({ fetchImpl })

    expect(fetchImpl.mock.calls[0][0]).toMatch(/data\/shade_tokyo_core5\.json$/)
  })

  it('loads a caller supplied GitHub Pages compatible URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => payload() })

    const result = await loadShadeData({ fetchImpl, url: '/CoolRoute_Tokyo/data/shade.json' })

    expect(fetchImpl).toHaveBeenCalledWith('/CoolRoute_Tokyo/data/shade.json')
    expect(result).toEqual(payload())
  })

  it('validates exact graph edge coverage', () => {
    expect(validateShadePayload(payload(), graph())).toEqual(payload())

    const missing = payload()
    missing.edgeShadeScores = {}
    expect(() => validateShadePayload(missing, graph())).toThrow(ShadeSchemaError)

    const unknown = payload()
    unknown.edgeShadeScores.unknown = [0, 0, 0]
    expect(() => validateShadePayload(unknown, graph())).toThrow(ShadeSchemaError)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1])(
    'rejects invalid score %s',
    (invalid) => {
      const candidate = payload()
      candidate.edgeShadeScores['a:b:0'][0] = invalid
      expect(() => validateShadePayload(candidate, graph())).toThrow(ShadeSchemaError)
    },
  )
})
