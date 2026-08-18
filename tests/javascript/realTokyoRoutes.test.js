import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import demoArea from '../../config/demo_area.json'
import { findShortestPath } from '../../src/routing/dijkstra.js'
import { prepareGraph } from '../../src/routing/graphLoader.js'
import { findNearestNode } from '../../src/routing/nearestNode.js'
import { buildRouteGeoJSON } from '../../src/routing/routeGeometry.js'

const payload = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/data/graph.json'), 'utf8'),
)
const graph = prepareGraph(payload)

const routeCases = [
  ['东京站北侧到丸之内', [139.7671, 35.6836], [139.7618, 35.6812]],
  ['大手町到东京站', [139.7638, 35.687], [139.7671, 35.6812]],
  ['皇居东侧到有乐町', [139.7555, 35.6845], [139.762, 35.6752]],
]

function snap(point) {
  return findNearestNode(graph, point, {
    boundingBox: demoArea.boundingBox,
    maximumDistanceMeters: 200,
  }).node
}

describe('正式东京 Road Graph 路线验收', () => {
  it.each(routeCases)('%s 能沿连续的真实 Edge geometry 生成路线', (_name, start, destination) => {
    const startNode = snap(start)
    const destinationNode = snap(destination)
    const route = findShortestPath(graph, startNode.id, destinationNode.id)

    expect(route.found).toBe(true)
    expect(route.totalDistance).toBeGreaterThan(50)
    expect(route.totalDistance).toBeLessThan(5_000)
    expect(route.edgeSequence).toHaveLength(route.nodeSequence.length - 1)

    route.edgeSequence.forEach((edge, index) => {
      expect(edge.source).toBe(route.nodeSequence[index])
      expect(edge.target).toBe(route.nodeSequence[index + 1])
      expect(edge.geometry.length).toBeGreaterThanOrEqual(2)
    })

    const geoJSON = buildRouteGeoJSON(route.edgeSequence)
    const expectedCoordinates = route.edgeSequence.flatMap(
      (edge, index) => index === 0 ? edge.geometry : edge.geometry.slice(1),
    )
    expect(geoJSON.geometry.type).toBe('LineString')
    expect(geoJSON.geometry.coordinates).toEqual(expectedCoordinates)
  })
})
