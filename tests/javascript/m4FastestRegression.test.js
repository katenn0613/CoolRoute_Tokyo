import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import demoArea from '../../config/demo_area.json'
import { findShortestPath } from '../../src/routing/dijkstra.js'
import { prepareGraph } from '../../src/routing/graphLoader.js'
import { findNearestNode } from '../../src/routing/nearestNode.js'

function readGraph(path) {
  return prepareGraph(JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')))
}

const baseline = readGraph('data/processed/environment/graph_schema_1_0_baseline.json')
const enriched = readGraph('public/data/graph.json')
const routeCases = [
  [[139.7671, 35.6836], [139.7618, 35.6812]],
  [[139.7638, 35.687], [139.7671, 35.6812]],
  [[139.7555, 35.6845], [139.762, 35.6752]],
]

function snap(graph, coordinate) {
  return findNearestNode(graph, coordinate, {
    boundingBox: demoArea.boundingBox,
    maximumDistanceMeters: 200,
  }).node.id
}

describe('M4 对 M3 Fastest Route 的回归保护', () => {
  it('保持 Node、Edge 与 MultiEdge 数量不变', () => {
    const multiEdges = (graph) => [...graph.adjacency.values()]
      .reduce((count, edges) => count + Math.max(0, edges.length - new Set(edges.map((edge) => edge.target)).size), 0)
    expect(enriched.nodes.size).toBe(baseline.nodes.size)
    expect(enriched.edges.size).toBe(baseline.edges.size)
    expect(multiEdges(enriched)).toBe(multiEdges(baseline))
  })

  it.each(routeCases)('保持真实路线 shortest-path cost 与 total distance', (start, destination) => {
    const baselineRoute = findShortestPath(baseline, snap(baseline, start), snap(baseline, destination))
    const enrichedRoute = findShortestPath(enriched, snap(enriched, start), snap(enriched, destination))
    expect(enrichedRoute.found).toBe(true)
    expect(enrichedRoute.totalDistance).toBe(baselineRoute.totalDistance)
    const baselineCost = baselineRoute.edgeSequence.reduce((sum, edge) => sum + edge.length, 0)
    const enrichedCost = enrichedRoute.edgeSequence.reduce((sum, edge) => sum + edge.length, 0)
    expect(enrichedCost).toBe(baselineCost)
    expect(enrichedRoute.edgeSequence.map((edge) => edge.id)).toEqual(
      baselineRoute.edgeSequence.map((edge) => edge.id),
    )
  })
})
