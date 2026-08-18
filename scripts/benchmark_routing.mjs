import { readFile, stat } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

import demoArea from '../config/demo_area.json' with { type: 'json' }
import { findShortestPath } from '../src/routing/dijkstra.js'
import { prepareGraph } from '../src/routing/graphLoader.js'
import { findNearestNode } from '../src/routing/nearestNode.js'
import { buildRouteGeoJSON } from '../src/routing/routeGeometry.js'

const graphUrl = new URL('../public/data/graph.json', import.meta.url)
const cases = [
  ['东京站北侧到丸之内', [139.7671, 35.6836], [139.7618, 35.6812]],
  ['大手町到东京站', [139.7638, 35.687], [139.7671, 35.6812]],
  ['皇居东侧到有乐町', [139.7555, 35.6845], [139.762, 35.6752]],
]

const readStartedAt = performance.now()
const graphText = await readFile(graphUrl, 'utf8')
const readTimeMs = performance.now() - readStartedAt

const parseStartedAt = performance.now()
const payload = JSON.parse(graphText)
const parseTimeMs = performance.now() - parseStartedAt

const prepareStartedAt = performance.now()
const graph = prepareGraph(payload)
const prepareTimeMs = performance.now() - prepareStartedAt

function snap(point) {
  return findNearestNode(graph, point, {
    boundingBox: demoArea.boundingBox,
    maximumDistanceMeters: 200,
  }).node
}

const routes = cases.map(([name, start, destination]) => {
  const totalStartedAt = performance.now()
  const snapStartedAt = performance.now()
  const startNode = snap(start)
  const destinationNode = snap(destination)
  const snapTimeMs = performance.now() - snapStartedAt

  const dijkstraStartedAt = performance.now()
  const result = findShortestPath(graph, startNode.id, destinationNode.id)
  const dijkstraTimeMs = performance.now() - dijkstraStartedAt

  const geometryStartedAt = performance.now()
  const geoJSON = buildRouteGeoJSON(result.edgeSequence)
  const geometryTimeMs = performance.now() - geometryStartedAt
  const totalTimeMs = performance.now() - totalStartedAt

  return {
    name,
    startNode: startNode.id,
    destinationNode: destinationNode.id,
    found: result.found,
    distanceMeters: Number(result.totalDistance.toFixed(1)),
    edgeCount: result.edgeSequence.length,
    geometryPointCount: geoJSON?.geometry.coordinates.length ?? 0,
    snapTimeMs: Number(snapTimeMs.toFixed(3)),
    dijkstraTimeMs: Number(dijkstraTimeMs.toFixed(3)),
    geometryTimeMs: Number(geometryTimeMs.toFixed(3)),
    totalTimeMs: Number(totalTimeMs.toFixed(3)),
  }
})

const graphStats = await stat(graphUrl)
process.stdout.write(`${JSON.stringify({
  graphBytes: graphStats.size,
  nodeCount: graph.nodes.size,
  edgeCount: graph.edges.size,
  localFileReadTimeMs: Number(readTimeMs.toFixed(3)),
  jsonParseTimeMs: Number(parseTimeMs.toFixed(3)),
  graphPrepareTimeMs: Number(prepareTimeMs.toFixed(3)),
  parseAndPrepareTimeMs: Number((parseTimeMs + prepareTimeMs).toFixed(3)),
  routes,
}, null, 2)}\n`)
