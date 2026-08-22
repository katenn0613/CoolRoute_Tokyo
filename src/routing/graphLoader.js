import { assetPath } from '../utils/assetPath.js'

const ENDPOINT_COORDINATE_TOLERANCE = 1e-7

export class GraphSchemaError extends Error {
  constructor(message) {
    super(message)
    this.name = 'GraphSchemaError'
  }
}

export class GraphLoadError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'GraphLoadError'
  }
}

function isFiniteCoordinate(lon, lat) {
  return (
    Number.isFinite(lon)
    && Number.isFinite(lat)
    && lon >= -180
    && lon <= 180
    && lat >= -90
    && lat <= 90
  )
}

function coordinatesMatch(first, second) {
  return Math.abs(first[0] - second[0]) <= ENDPOINT_COORDINATE_TOLERANCE
    && Math.abs(first[1] - second[1]) <= ENDPOINT_COORDINATE_TOLERANCE
}

export function validateGraphPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new GraphSchemaError('Road Graph 必须是 JSON 对象。')
  }

  const { metadata, nodes, edges } = payload
  if (!metadata || typeof metadata !== 'object') {
    throw new GraphSchemaError('Road Graph 缺少 metadata。')
  }
  if (!['1.0.0', '1.1.0'].includes(metadata.graphVersion)) {
    throw new GraphSchemaError(`不支持的 Browser Graph Schema：${metadata.graphVersion ?? 'missing'}`)
  }
  if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) {
    throw new GraphSchemaError('Road Graph nodes 必须是对象。')
  }
  if (!Array.isArray(edges)) {
    throw new GraphSchemaError('Road Graph edges 必须是数组。')
  }

  const nodeEntries = Object.entries(nodes)
  if (metadata.nodeCount !== nodeEntries.length) {
    throw new GraphSchemaError('metadata Node 数量与内容不一致。')
  }
  if (metadata.edgeCount !== edges.length) {
    throw new GraphSchemaError('metadata Edge 数量与内容不一致。')
  }
  if (nodeEntries.length === 0 || edges.length === 0) {
    throw new GraphSchemaError('Road Graph 必须包含 Node 和 Edge。')
  }

  for (const [nodeId, node] of nodeEntries) {
    if (!node || typeof node !== 'object' || node.id !== nodeId) {
      throw new GraphSchemaError(`Node ${nodeId} 的 ID 无效。`)
    }
    if (!isFiniteCoordinate(node.lon, node.lat)) {
      throw new GraphSchemaError(`Node ${nodeId} 的经纬度无效。`)
    }
  }

  const edgeIds = new Set()
  for (const edge of edges) {
    if (!edge || typeof edge !== 'object' || typeof edge.id !== 'string' || !edge.id) {
      throw new GraphSchemaError('Road Graph 存在无效 Edge ID。')
    }
    if (edgeIds.has(edge.id)) {
      throw new GraphSchemaError(`Road Graph 存在重复 Edge ID：${edge.id}`)
    }
    edgeIds.add(edge.id)
    if (!Object.hasOwn(nodes, edge.source) || !Object.hasOwn(nodes, edge.target)) {
      throw new GraphSchemaError(`Edge ${edge.id} 引用了不存在的 Node。`)
    }
    if (!Number.isFinite(edge.length) || edge.length <= 0) {
      throw new GraphSchemaError(`Edge ${edge.id} 的 length 无效。`)
    }
    if (
      !Array.isArray(edge.geometry)
      || edge.geometry.length < 2
      || edge.geometry.some(
        (point) => !Array.isArray(point)
          || point.length !== 2
          || !isFiniteCoordinate(point[0], point[1]),
      )
    ) {
      throw new GraphSchemaError(`Edge ${edge.id} 的 geometry 无效。`)
    }
    const sourceNode = nodes[edge.source]
    const targetNode = nodes[edge.target]
    if (
      !coordinatesMatch(edge.geometry[0], [sourceNode.lon, sourceNode.lat])
      || !coordinatesMatch(edge.geometry.at(-1), [targetNode.lon, targetNode.lat])
    ) {
      throw new GraphSchemaError(`Edge ${edge.id} 的 geometry 未遵循 source → target。`)
    }
    if (metadata.graphVersion === '1.1.0') {
      for (const field of ['green_score', 'water_penalty']) {
        if (!Number.isFinite(edge[field]) || edge[field] < 0 || edge[field] > 1) {
          throw new GraphSchemaError(`Edge ${edge.id} 的 ${field} 无效。`)
        }
      }
    }
  }

  return payload
}

export function prepareGraph(payload) {
  validateGraphPayload(payload)
  const nodes = new Map(Object.entries(payload.nodes))
  const edges = new Map()
  const adjacency = new Map([...nodes.keys()].map((nodeId) => [nodeId, []]))

  for (const edge of payload.edges) {
    edges.set(edge.id, edge)
    adjacency.get(edge.source).push(edge)
  }

  return {
    metadata: payload.metadata,
    nodes,
    edges,
    adjacency,
  }
}

export async function loadRoadGraph({
  fetchImpl = globalThis.fetch,
  url = assetPath('data/graph_tokyo_core5.json'),
} = {}) {
  const startedAt = performance.now()
  let response
  try {
    response = await fetchImpl(url)
  } catch (error) {
    throw new GraphLoadError('无法连接 Road Graph 静态资源。', { cause: error })
  }
  if (!response?.ok) {
    throw new GraphLoadError(`Road Graph 加载失败（HTTP ${response?.status ?? 'unknown'}）。`)
  }

  let payload
  try {
    payload = await response.json()
  } catch (error) {
    throw new GraphLoadError('Road Graph 不是有效 JSON。', { cause: error })
  }

  const graph = prepareGraph(payload)
  return {
    graph,
    loadTimeMs: performance.now() - startedAt,
  }
}
