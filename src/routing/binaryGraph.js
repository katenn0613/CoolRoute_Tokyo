const COORDINATE_SCALE = 1e7

export class BinaryGraphError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'BinaryGraphError'
  }
}

export function decodeBinaryGraph(buffer, { coordinateScale = COORDINATE_SCALE } = {}) {
  const view = new DataView(
    buffer instanceof ArrayBuffer ? buffer : buffer.buffer,
    buffer instanceof ArrayBuffer ? 0 : buffer.byteOffset,
    buffer.byteLength,
  )
  const magic = view.getUint32(0, true)
  if (magic !== 0x52434752) throw new BinaryGraphError('不是有效的 CoolRoute 二进制图（magic 不匹配）。')
  const version = view.getUint32(4, true)
  if (version !== 1) throw new BinaryGraphError(`不支持的二进制图版本：${version}`)
  const nodeCount = view.getUint32(8, true)
  const edgeCount = view.getUint32(12, true)
  const pointCount = view.getUint32(16, true)
  const scenarioCount = view.getUint32(20, true)

  const nodeLon = new Float64Array(nodeCount)
  const nodeLat = new Float64Array(nodeCount)
  const edgeSource = new Int32Array(edgeCount)
  const edgeTarget = new Int32Array(edgeCount)
  const edgeLength = new Float32Array(edgeCount)
  const edgeGreen = new Float32Array(edgeCount)
  const edgeWater = new Float32Array(edgeCount)
  const geometryOffset = new Uint32Array(edgeCount + 1)
  const geomLon = new Float64Array(pointCount)
  const geomLat = new Float64Array(pointCount)
  const shade = new Float32Array(edgeCount * scenarioCount)

  let offset = 24
  for (let i = 0; i < nodeCount; i += 1) {
    nodeLon[i] = view.getInt32(offset, true) / coordinateScale
    nodeLat[i] = view.getInt32(offset + 4, true) / coordinateScale
    offset += 8
  }
  for (let i = 0; i < edgeCount; i += 1) {
    edgeSource[i] = view.getInt32(offset, true)
    edgeTarget[i] = view.getInt32(offset + 4, true)
    edgeLength[i] = view.getFloat32(offset + 8, true)
    edgeGreen[i] = view.getFloat32(offset + 12, true)
    edgeWater[i] = view.getFloat32(offset + 16, true)
    offset += 20
  }
  for (let i = 0; i <= edgeCount; i += 1) {
    geometryOffset[i] = view.getUint32(offset, true)
    offset += 4
  }
  for (let i = 0; i < pointCount; i += 1) {
    geomLon[i] = view.getInt32(offset, true) / coordinateScale
    geomLat[i] = view.getInt32(offset + 4, true) / coordinateScale
    offset += 8
  }
  for (let i = 0; i < edgeCount * scenarioCount; i += 1) {
    shade[i] = view.getFloat32(offset, true)
    offset += 4
  }

  const expectedSize = 24
    + nodeCount * 8
    + edgeCount * 20
    + (edgeCount + 1) * 4
    + pointCount * 8
    + edgeCount * scenarioCount * 4
  if (offset !== expectedSize || offset !== buffer.byteLength) {
    throw new BinaryGraphError('二进制图大小与头部声明不一致。')
  }

  return {
    version,
    nodeCount,
    edgeCount,
    pointCount,
    scenarioCount,
    nodeLon,
    nodeLat,
    edgeSource,
    edgeTarget,
    edgeLength,
    edgeGreen,
    edgeWater,
    geometryOffset,
    geomLon,
    geomLat,
    shade,
  }
}

export function scenarioIndex(scenario, scenarioNames = ['09:00', '12:00', '15:00']) {
  const index = scenarioNames.indexOf(scenario)
  if (index < 0) throw new RangeError(`不支持的 Shade 场景：${scenario}`)
  return index
}

export function edgeGeometry(graph, edgeIndex) {
  const start = graph.geometryOffset[edgeIndex]
  const end = graph.geometryOffset[edgeIndex + 1]
  const points = []
  for (let i = start; i < end; i += 1) {
    points.push([graph.geomLon[i], graph.geomLat[i]])
  }
  return points
}

export function materializeEdge(graph, edgeIndex) {
  const source = graph.edgeSource[edgeIndex]
  const target = graph.edgeTarget[edgeIndex]
  return {
    id: String(edgeIndex),
    source: String(source),
    target: String(target),
    length: graph.edgeLength[edgeIndex],
    green_score: graph.edgeGreen[edgeIndex],
    water_penalty: graph.edgeWater[edgeIndex],
    geometry: edgeGeometry(graph, edgeIndex),
  }
}

export function edgeShadeScore(graph, edgeIndex, scenario) {
  const index = scenarioIndex(scenario)
  return graph.shade[edgeIndex * graph.scenarioCount + index]
}
