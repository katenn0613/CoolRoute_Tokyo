import { routingConfig } from '../config/routingConfig.js'
import { MinHeap } from './dijkstra.js'
import {
  calculateHeatExposureFromScores,
  calculateShadeAwareHeatExposureFromScores,
} from './exposureModel.js'
import { edgeShadeScore } from './binaryGraph.js'
import {
  NearestNodeError,
  PointOutsideDemoAreaError,
  distanceMeters,
  isPointInDemoArea,
} from './nearestNode.js'

export class BinaryRoutingError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BinaryRoutingError'
  }
}

const MODE_LAMBDAS = Object.freeze({
  fastest: 0,
  balanced: routingConfig.balancedLambda,
  coolest: routingConfig.coolestLambda,
})

export function buildAdjacency(graph) {
  const offsets = new Uint32Array(graph.nodeCount + 1)
  for (let edgeIndex = 0; edgeIndex < graph.edgeCount; edgeIndex += 1) {
    const source = graph.edgeSource[edgeIndex]
    if (source < 0 || source >= graph.nodeCount) {
      throw new BinaryRoutingError(`Edge ${edgeIndex} 的 source 不存在。`)
    }
    offsets[source + 1] += 1
  }
  for (let index = 1; index < offsets.length; index += 1) offsets[index] += offsets[index - 1]
  const cursors = offsets.slice(0, graph.nodeCount)
  const edgeList = new Int32Array(graph.edgeCount)
  for (let edgeIndex = 0; edgeIndex < graph.edgeCount; edgeIndex += 1) {
    const source = graph.edgeSource[edgeIndex]
    edgeList[cursors[source]] = edgeIndex
    cursors[source] += 1
  }
  return { offsets, edgeList }
}

export function edgeExposureBinary(graph, edgeIndex, scenario = null) {
  const greenScore = graph.edgeGreen[edgeIndex]
  const waterPenalty = graph.edgeWater[edgeIndex]
  if (scenario === null || graph.scenarioCount === 0) {
    return calculateHeatExposureFromScores(greenScore, waterPenalty)
  }
  return calculateShadeAwareHeatExposureFromScores(
    greenScore,
    waterPenalty,
    edgeShadeScore(graph, edgeIndex, scenario),
  )
}

export function findNearestNodeBinary(graph, point, { boundingBox, maximumDistanceMeters }) {
  if (!isPointInDemoArea(point, boundingBox)) throw new PointOutsideDemoAreaError()
  if (!graph || graph.nodeCount === 0) throw new BinaryRoutingError('Road Graph 没有可用于吸附的 Node。')
  let nearestIndex = -1
  let nearestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < graph.nodeCount; index += 1) {
    const distance = distanceMeters(point, [graph.nodeLon[index], graph.nodeLat[index]])
    if (distance < nearestDistance) {
      nearestIndex = index
      nearestDistance = distance
    }
  }
  if (nearestIndex < 0 || nearestDistance > maximumDistanceMeters) {
    throw new NearestNodeError(`附近 ${maximumDistanceMeters} m 内没有可用的步行道路节点。`)
  }
  return {
    index: nearestIndex,
    id: String(nearestIndex),
    lon: graph.nodeLon[nearestIndex],
    lat: graph.nodeLat[nearestIndex],
    distanceMeters: nearestDistance,
  }
}

function edgeCost(graph, edgeIndex, lambda, scenario) {
  const length = graph.edgeLength[edgeIndex]
  if (lambda === 0) return length
  return length * (1 + lambda * edgeExposureBinary(graph, edgeIndex, scenario))
}

export function weightedDijkstraBinary(
  graph,
  adjacency,
  startIndex,
  destinationIndex,
  { mode = 'fastest', scenario = null } = {},
) {
  if (!graph || !adjacency) throw new BinaryRoutingError('二进制图尚未准备完成。')
  if (
    !Number.isInteger(startIndex)
    || !Number.isInteger(destinationIndex)
    || startIndex < 0
    || startIndex >= graph.nodeCount
    || destinationIndex < 0
    || destinationIndex >= graph.nodeCount
  ) throw new BinaryRoutingError('Start 或 Destination Node 不存在。')
  if (!Object.hasOwn(MODE_LAMBDAS, mode)) throw new BinaryRoutingError(`未知 Routing Mode：${mode}`)

  const distances = new Float64Array(graph.nodeCount)
  distances.fill(Number.POSITIVE_INFINITY)
  const predecessorNode = new Int32Array(graph.nodeCount)
  predecessorNode.fill(-1)
  const predecessorEdge = new Int32Array(graph.nodeCount)
  predecessorEdge.fill(-1)
  const settled = new Uint8Array(graph.nodeCount)
  const queue = new MinHeap()
  distances[startIndex] = 0
  queue.push({ nodeId: startIndex, cost: 0 })

  while (queue.size > 0) {
    const current = queue.pop()
    if (current.cost !== distances[current.nodeId] || settled[current.nodeId]) continue
    if (current.nodeId === destinationIndex) break
    settled[current.nodeId] = 1
    for (
      let position = adjacency.offsets[current.nodeId];
      position < adjacency.offsets[current.nodeId + 1];
      position += 1
    ) {
      const edgeIndex = adjacency.edgeList[position]
      const target = graph.edgeTarget[edgeIndex]
      if (target < 0 || target >= graph.nodeCount) {
        throw new BinaryRoutingError(`Edge ${edgeIndex} 的 target 不存在。`)
      }
      const candidate = current.cost + edgeCost(
        graph,
        edgeIndex,
        MODE_LAMBDAS[mode],
        scenario,
      )
      if (candidate < distances[target]) {
        distances[target] = candidate
        predecessorNode[target] = current.nodeId
        predecessorEdge[target] = edgeIndex
        queue.push({ nodeId: target, cost: candidate })
      }
    }
  }

  if (!Number.isFinite(distances[destinationIndex])) {
    return {
      found: false,
      totalDistance: Number.POSITIVE_INFINITY,
      totalCost: Number.POSITIVE_INFINITY,
      nodeSequence: [],
      edgeSequence: [],
    }
  }

  const nodeSequence = [destinationIndex]
  const edgeSequence = []
  let cursor = destinationIndex
  while (cursor !== startIndex) {
    const edgeIndex = predecessorEdge[cursor]
    if (edgeIndex < 0) {
      throw new BinaryRoutingError('Predecessor 链不完整。')
    }
    edgeSequence.push(edgeIndex)
    cursor = predecessorNode[cursor]
    nodeSequence.push(cursor)
  }
  nodeSequence.reverse()
  edgeSequence.reverse()
  let totalDistance = 0
  for (const edgeIndex of edgeSequence) totalDistance += graph.edgeLength[edgeIndex]
  return {
    found: true,
    totalDistance,
    totalCost: distances[destinationIndex],
    nodeSequence,
    edgeSequence,
  }
}
