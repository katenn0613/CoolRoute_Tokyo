export class RouteCalculationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RouteCalculationError'
  }
}

export class MinHeap {
  constructor() {
    this.items = []
  }

  push(value) {
    this.items.push(value)
    let index = this.items.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.items[parent].cost <= value.cost) break
      this.items[index] = this.items[parent]
      index = parent
    }
    this.items[index] = value
  }

  pop() {
    if (this.items.length === 0) return null
    const first = this.items[0]
    const last = this.items.pop()
    if (this.items.length === 0) return first

    let index = 0
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      if (left >= this.items.length) break
      let child = left
      if (right < this.items.length && this.items[right].cost < this.items[left].cost) {
        child = right
      }
      if (this.items[child].cost >= last.cost) break
      this.items[index] = this.items[child]
      index = child
    }
    this.items[index] = last
    return first
  }

  get size() {
    return this.items.length
  }
}

const unreachableResult = () => ({
  found: false,
  totalDistance: Number.POSITIVE_INFINITY,
  totalCost: Number.POSITIVE_INFINITY,
  nodeSequence: [],
  edgeSequence: [],
})

export function weightedDijkstra(graph, startId, destinationId, weightFunction) {
  if (!(graph?.nodes instanceof Map) || !(graph?.adjacency instanceof Map)) {
    throw new RouteCalculationError('Road Graph 尚未准备完成。')
  }
  if (!graph.nodes.has(startId) || !graph.nodes.has(destinationId)) {
    throw new RouteCalculationError('Start 或 Destination Node 不存在。')
  }
  if (typeof weightFunction !== 'function') {
    throw new RouteCalculationError('weightedDijkstra 需要有效 Weight Function。')
  }
  if (startId === destinationId) {
    return {
      found: true,
      totalDistance: 0,
      totalCost: 0,
      nodeSequence: [startId],
      edgeSequence: [],
    }
  }

  const distances = new Map([[startId, 0]])
  const predecessors = new Map()
  const queue = new MinHeap()
  queue.push({ nodeId: startId, cost: 0 })

  while (queue.size > 0) {
    const current = queue.pop()
    if (current.cost !== distances.get(current.nodeId)) continue
    if (current.nodeId === destinationId) break

    for (const edge of graph.adjacency.get(current.nodeId) ?? []) {
      if (!Number.isFinite(edge?.length) || edge.length < 0) {
        throw new RouteCalculationError(`Edge ${edge?.id ?? 'unknown'} 的 length 必须是非负有限数。`)
      }
      const edgeCost = weightFunction(edge)
      if (!Number.isFinite(edgeCost) || edgeCost < 0) {
        throw new RouteCalculationError(`Edge ${edge.id} 的 cost 必须是非负有限数。`)
      }
      const candidateCost = current.cost + edgeCost
      const knownCost = distances.get(edge.target) ?? Number.POSITIVE_INFINITY
      if (candidateCost < knownCost) {
        distances.set(edge.target, candidateCost)
        predecessors.set(edge.target, { nodeId: current.nodeId, edge })
        queue.push({ nodeId: edge.target, cost: candidateCost })
      }
    }
  }

  if (!distances.has(destinationId)) return unreachableResult()

  const nodeSequence = [destinationId]
  const edgeSequence = []
  let cursor = destinationId
  while (cursor !== startId) {
    const predecessor = predecessors.get(cursor)
    if (!predecessor) return unreachableResult()
    edgeSequence.push(predecessor.edge)
    cursor = predecessor.nodeId
    nodeSequence.push(cursor)
  }
  nodeSequence.reverse()
  edgeSequence.reverse()

  const totalDistance = edgeSequence.reduce((sum, edge) => sum + edge.length, 0)

  return {
    found: true,
    totalDistance,
    totalCost: distances.get(destinationId),
    nodeSequence,
    edgeSequence,
  }
}

export function findShortestPath(graph, startId, destinationId) {
  return weightedDijkstra(graph, startId, destinationId, (edge) => edge.length)
}
