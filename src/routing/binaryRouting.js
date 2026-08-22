import { MinHeap } from './dijkstra.js'
import { scenarioIndex } from './binaryGraph.js'
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

// 与 src/config/routingConfig.js 保持一致。
const GREEN_WEIGHT = 0.7
const WATER_WEIGHT = 0.3
const SHADE_WEIGHT = 0.25
const LAMBDAS = Object.freeze({ fastest: 0, balanced: 1, coolest: 3 })

export function buildAdjacency(graph) {
  const counts = new Uint32Array(graph.nodeCount + 1)
  for (let i = 0; i < graph.edgeCount; i += 1) {
    counts[graph.edgeSource[i] + 1] += 1
  }
  const offsets = new Uint32Array(graph.nodeCount + 1)
  for (let i = 0; i < graph.nodeCount; i += 1) {
    offsets[i + 1] = offsets[i] + counts[i + 1]
  }
  const cursor = offsets.slice(0, graph.nodeCount)
  const edgeList = new Int32Array(graph.edgeCount)
  for (let i = 0; i < graph.edgeCount; i += 1) {
    const source = graph.edgeSource[i]
    edgeList[cursor[source]] = i
    cursor[source] += 1
  }
  return { offsets, edgeList }
}

export function edgeExposure(graph, edgeIndex, scenario = null) {
  const base = GREEN_WEIGHT * (1 - graph.edgeGreen[edgeIndex])
    + WATER_WEIGHT * graph.edgeWater[edgeIndex]
  // 无阴影模式（scenarioCount === 0）：忽略场景，仅用 base（绿地/给水）暴露。
  if (scenario === null || graph.scenarioCount === 0) return base
  const shadeScore = graph.shade[edgeIndex * graph.scenarioCount + scenarioIndex(scenario)]
  return (1 - SHADE_WEIGHT) * base + SHADE_WEIGHT * (1 - shadeScore)
}

export function edgeCost(graph, edgeIndex, { lambda, scenario = null }) {
  const length = graph.edgeLength[edgeIndex]
  if (lambda === 0) return length
  return length * (1 + lambda * edgeExposure(graph, edgeIndex, scenario))
}

export function findNearestNodeBinary(
  graph,
  point,
  { boundingBox, maximumDistanceMeters },
) {
  if (!isPointInDemoArea(point, boundingBox)) {
    throw new PointOutsideDemoAreaError()
  }
  if (!graph || graph.nodeCount === 0) {
    throw new BinaryRoutingError('Road Graph 没有可用于吸附的 Node。')
  }
  let bestIndex = -1
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < graph.nodeCount; i += 1) {
    const candidate = distanceMeters(point, [graph.nodeLon[i], graph.nodeLat[i]])
    if (candidate < bestDistance) {
      bestDistance = candidate
      bestIndex = i
    }
  }
  if (bestIndex < 0 || bestDistance > maximumDistanceMeters) {
    throw new NearestNodeError(`附近 ${maximumDistanceMeters} m 内没有可用的步行道路节点。`)
  }
  return {
    index: bestIndex,
    lon: graph.nodeLon[bestIndex],
    lat: graph.nodeLat[bestIndex],
    distanceMeters: bestDistance,
  }
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
  ) {
    throw new BinaryRoutingError('Start 或 Destination Node 不存在。')
  }
  if (!Object.hasOwn(LAMBDAS, mode)) throw new BinaryRoutingError(`未知 Routing Mode：${mode}`)
  const lambda = LAMBDAS[mode]

  const distances = new Float64Array(graph.nodeCount).fill(Number.POSITIVE_INFINITY)
  const predecessorNode = new Int32Array(graph.nodeCount).fill(-1)
  const predecessorEdge = new Int32Array(graph.nodeCount).fill(-1)
  const settled = new Uint8Array(graph.nodeCount)
  distances[startIndex] = 0

  const queue = new MinHeap()
  queue.push({ nodeId: startIndex, cost: 0 })

  while (queue.size > 0) {
    const current = queue.pop()
    if (current.cost !== distances[current.nodeId]) continue
    if (current.nodeId === destinationIndex) break
    if (settled[current.nodeId]) continue
    settled[current.nodeId] = 1

    const start = adjacency.offsets[current.nodeId]
    const end = adjacency.offsets[current.nodeId + 1]
    for (let position = start; position < end; position += 1) {
      const edgeIndex = adjacency.edgeList[position]
      const target = graph.edgeTarget[edgeIndex]
      const cost = edgeCost(graph, edgeIndex, { lambda, scenario })
      const candidateCost = current.cost + cost
      if (candidateCost < distances[target]) {
        distances[target] = candidateCost
        predecessorNode[target] = current.nodeId
        predecessorEdge[target] = edgeIndex
        queue.push({ nodeId: target, cost: candidateCost })
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
      return {
        found: false,
        totalDistance: Number.POSITIVE_INFINITY,
        totalCost: Number.POSITIVE_INFINITY,
        nodeSequence: [],
        edgeSequence: [],
      }
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
