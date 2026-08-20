import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import demoArea from '../../config/demo_area.json'
import baseline from './fixtures/m4FastestBaseline.json'
import { findShortestPath } from '../../src/routing/dijkstra.js'
import { prepareGraph } from '../../src/routing/graphLoader.js'
import { findNearestNode } from '../../src/routing/nearestNode.js'

const enriched = prepareGraph(JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/data/graph.json'), 'utf8'),
))

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
    expect(enriched.nodes.size).toBe(baseline.nodeCount)
    expect(enriched.edges.size).toBe(baseline.edgeCount)
    expect(multiEdges(enriched)).toBe(baseline.multiEdgeCount)
  })

  it.each(baseline.routes)('保持真实路线 shortest-path cost 与 total distance', (routeCase) => {
    expect(snap(enriched, routeCase.start)).toBe(routeCase.startNodeId)
    expect(snap(enriched, routeCase.destination)).toBe(routeCase.destinationNodeId)
    const enrichedRoute = findShortestPath(
      enriched,
      routeCase.startNodeId,
      routeCase.destinationNodeId,
    )
    expect(enrichedRoute.found).toBe(true)
    expect(enrichedRoute.totalDistance).toBe(routeCase.totalDistance)
    const enrichedCost = enrichedRoute.edgeSequence.reduce((sum, edge) => sum + edge.length, 0)
    expect(enrichedCost).toBe(routeCase.totalDistance)
    expect(enrichedRoute.edgeSequence.map((edge) => edge.id)).toEqual(routeCase.edgeIds)
  })
})
