import { describe, expect, it } from 'vitest'
import { findShortestPath, weightedDijkstra } from '../../src/routing/dijkstra.js'
import { ROUTING_MODES, createEdgeWeightFunction } from '../../src/routing/exposureModel.js'
import { createSyntheticRoadGraph } from './fixtures/syntheticRoadGraph.js'

describe('Dijkstra Fastest Route', () => {
  it('returns the hand-calculated shortest node and edge sequence', () => {
    const result = findShortestPath(createSyntheticRoadGraph(), 'a', 'd')

    expect(result.found).toBe(true)
    expect(result.nodeSequence).toEqual(['a', 'b', 'd'])
    expect(result.edgeSequence.map((edge) => edge.id)).toEqual(['a:b:fast', 'b:d:0'])
    expect(result.totalDistance).toBe(7)
    expect(result.totalCost).toBe(7)
  })

  it('keeps parallel edges distinct and chooses the lower-cost edge', () => {
    const result = findShortestPath(createSyntheticRoadGraph(), 'a', 'b')

    expect(result.edgeSequence).toHaveLength(1)
    expect(result.edgeSequence[0].id).toBe('a:b:fast')
    expect(result.totalDistance).toBe(2)
  })

  it('returns an explicit unreachable result for disconnected nodes', () => {
    const result = findShortestPath(createSyntheticRoadGraph(), 'a', 'x')

    expect(result).toEqual({
      found: false,
      totalDistance: Number.POSITIVE_INFINITY,
      totalCost: Number.POSITIVE_INFINITY,
      nodeSequence: [],
      edgeSequence: [],
    })
  })

  it('returns a zero-length route when start equals destination', () => {
    const result = findShortestPath(createSyntheticRoadGraph(), 'a', 'a')

    expect(result).toEqual({
      found: true,
      totalDistance: 0,
      totalCost: 0,
      nodeSequence: ['a'],
      edgeSequence: [],
    })
  })

  it('avoids a short high-exposure path when lambda is high', () => {
    const graph = createSyntheticRoadGraph()
    for (const edge of graph.edges.values()) {
      edge.green_score = edge.id.startsWith('a:b') || edge.id === 'b:d:0' ? 0 : 1
      edge.water_penalty = 0
    }
    const fastest = weightedDijkstra(graph, 'a', 'd', createEdgeWeightFunction(ROUTING_MODES.FASTEST))
    const coolest = weightedDijkstra(graph, 'a', 'd', createEdgeWeightFunction(ROUTING_MODES.COOLEST))

    expect(fastest.edgeSequence.map((edge) => edge.id)).toEqual(['a:b:fast', 'b:d:0'])
    expect(coolest.edgeSequence.map((edge) => edge.id)).toEqual(['a:c:0', 'c:d:0'])
  })

  it('reports total cost equal to distance plus lambda times exposure load', () => {
    const graph = createSyntheticRoadGraph()
    for (const edge of graph.edges.values()) {
      edge.green_score = 0.5
      edge.water_penalty = 0.2
    }
    const result = weightedDijkstra(
      graph, 'a', 'd', createEdgeWeightFunction(ROUTING_MODES.BALANCED),
    )
    const exposureLoad = result.edgeSequence.reduce(
      (sum, edge) => sum + edge.length * (0.7 * (1 - edge.green_score) + 0.3 * edge.water_penalty), 0,
    )
    expect(result.totalCost).toBeCloseTo(result.totalDistance + exposureLoad)
  })

  it('rejects a non-finite or negative injected edge cost', () => {
    expect(() => weightedDijkstra(createSyntheticRoadGraph(), 'a', 'd', () => Number.NaN)).toThrow(/cost/i)
    expect(() => weightedDijkstra(createSyntheticRoadGraph(), 'a', 'd', () => -1)).toThrow(/cost/i)
  })

  it('rejects invalid physical edge length even when a custom weight ignores it', () => {
    const graph = createSyntheticRoadGraph()
    graph.adjacency.get('a')[0].length = Number.NaN
    expect(() => weightedDijkstra(graph, 'a', 'd', () => 0)).toThrow(/length/)
  })
})
