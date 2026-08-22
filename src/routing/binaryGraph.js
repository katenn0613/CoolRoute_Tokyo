const HEADER_BYTES = 24
const MAGIC = 0x52434752
const SUPPORTED_VERSION = 1
const COORDINATE_SCALE = 1e7
const DEFAULT_SCENARIOS = Object.freeze(['09:00', '12:00', '15:00'])

export class BinaryGraphError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'BinaryGraphError'
  }
}

function normalizeBuffer(input) {
  if (input instanceof ArrayBuffer) {
    return { buffer: input, byteOffset: 0, byteLength: input.byteLength }
  }
  if (ArrayBuffer.isView(input)) {
    return {
      buffer: input.buffer,
      byteOffset: input.byteOffset,
      byteLength: input.byteLength,
    }
  }
  throw new BinaryGraphError('二进制图必须是 ArrayBuffer 或 TypedArray。')
}

export function decodeBinaryGraph(input, { coordinateScale = COORDINATE_SCALE } = {}) {
  const source = normalizeBuffer(input)
  if (source.byteLength < HEADER_BYTES) {
    throw new BinaryGraphError('二进制图大小不足，无法读取头部。')
  }
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength)
  const magic = view.getUint32(0, true)
  if (magic !== MAGIC) throw new BinaryGraphError('不是有效的 CoolRoute 二进制图（magic 不匹配）。')
  const version = view.getUint32(4, true)
  if (version !== SUPPORTED_VERSION) throw new BinaryGraphError(`不支持的二进制图版本：${version}`)
  const nodeCount = view.getUint32(8, true)
  const edgeCount = view.getUint32(12, true)
  const pointCount = view.getUint32(16, true)
  const scenarioCount = view.getUint32(20, true)
  const expectedSize = HEADER_BYTES
    + nodeCount * 8
    + edgeCount * 20
    + (edgeCount + 1) * 4
    + pointCount * 8
    + edgeCount * scenarioCount * 4
  if (!Number.isSafeInteger(expectedSize) || expectedSize !== source.byteLength) {
    throw new BinaryGraphError('二进制图大小与头部声明不一致。')
  }

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

  let offset = HEADER_BYTES
  for (let index = 0; index < nodeCount; index += 1) {
    nodeLon[index] = view.getInt32(offset, true) / coordinateScale
    nodeLat[index] = view.getInt32(offset + 4, true) / coordinateScale
    offset += 8
  }
  for (let index = 0; index < edgeCount; index += 1) {
    edgeSource[index] = view.getInt32(offset, true)
    edgeTarget[index] = view.getInt32(offset + 4, true)
    edgeLength[index] = view.getFloat32(offset + 8, true)
    edgeGreen[index] = view.getFloat32(offset + 12, true)
    edgeWater[index] = view.getFloat32(offset + 16, true)
    offset += 20
  }
  for (let index = 0; index <= edgeCount; index += 1) {
    geometryOffset[index] = view.getUint32(offset, true)
    offset += 4
  }
  for (let index = 0; index < pointCount; index += 1) {
    geomLon[index] = view.getInt32(offset, true) / coordinateScale
    geomLat[index] = view.getInt32(offset + 4, true) / coordinateScale
    offset += 8
  }
  for (let index = 0; index < shade.length; index += 1) {
    shade[index] = view.getFloat32(offset, true)
    offset += 4
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

export function scenarioIndex(scenario, scenarioNames = DEFAULT_SCENARIOS) {
  const index = scenarioNames.indexOf(scenario)
  if (index < 0) throw new RangeError(`不支持的 Shade 场景：${scenario}`)
  return index
}

export function edgeGeometry(graph, edgeIndex) {
  const start = graph.geometryOffset[edgeIndex]
  const end = graph.geometryOffset[edgeIndex + 1]
  const geometry = []
  for (let index = start; index < end; index += 1) {
    geometry.push([graph.geomLon[index], graph.geomLat[index]])
  }
  return geometry
}

export function materializeEdge(graph, edgeIndex) {
  return {
    id: String(edgeIndex),
    source: String(graph.edgeSource[edgeIndex]),
    target: String(graph.edgeTarget[edgeIndex]),
    length: graph.edgeLength[edgeIndex],
    green_score: graph.edgeGreen[edgeIndex],
    water_penalty: graph.edgeWater[edgeIndex],
    geometry: edgeGeometry(graph, edgeIndex),
  }
}

export function edgeShadeScore(graph, edgeIndex, scenario) {
  if (graph.scenarioCount === 0) return null
  return graph.shade[edgeIndex * graph.scenarioCount + scenarioIndex(scenario)]
}
