import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { prepareGraph } from '../../src/routing/graphLoader.js'
import { useShadeLayer } from '../../src/shade/useShadeLayer.js'

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

const payload = {
  metadata: {
    schemaVersion: '1.0.0', roadGraphSchemaVersion: '1.1.0',
    roadGraphGeneratedAt: 'graph-time', edgeCount: 1,
    scenarios: ['09:00', '12:00', '15:00'],
  },
  edgeShadeScores: { 'a:b:0': [0.1, 0.5, 0.9] },
}

describe('useShadeLayer', () => {
  it('loads independently and changes scenario without loading again', async () => {
    const loadShade = vi.fn().mockResolvedValue(payload)
    const { result } = renderHook(() => useShadeLayer({ graph, loadShade }))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.scenario).toBe('12:00')
    expect(result.current.geoJSON.features[0].properties.shadeScore).toBe(0.5)

    act(() => result.current.setScenario('15:00'))
    expect(result.current.geoJSON.features[0].properties.shadeScore).toBe(0.9)
    expect(loadShade).toHaveBeenCalledTimes(1)
  })

  it('isolates sidecar load failure from the supplied road graph', async () => {
    const loadShade = vi.fn().mockRejectedValue(new Error('technical detail'))
    const { result } = renderHook(() => useShadeLayer({ graph, loadShade }))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe('日陰データを利用できません。')
    expect(graph.edges.size).toBe(1)
  })
})
