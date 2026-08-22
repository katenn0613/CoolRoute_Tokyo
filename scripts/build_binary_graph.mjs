import { gzipSync } from 'node:zlib'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const GRAPH_URL = new URL('../public/data/graph_tokyo23.json', import.meta.url)
const SHADE_URL = new URL('../public/data/shade_tokyo23.json', import.meta.url)
const OUTPUT_URL = new URL('../public/data/graph_tokyo23.bin', import.meta.url)
const OUTPUT_GZ_URL = new URL('../public/data/graph_tokyo23.bin.gz', import.meta.url)

const MAGIC = 0x52434752 // 'CRGR'
const VERSION = 1
const COORDINATE_SCALE = 1e7
const SCENARIOS = ['09:00', '12:00', '15:00']
const SHADE_METADATA_URL = new URL('../public/data/shade_metadata_tokyo23.json', import.meta.url)

function quantize(value) {
  const quantized = Math.round(value * COORDINATE_SCALE)
  if (!Number.isFinite(quantized) || quantized < -2147483648 || quantized > 2147483647) {
    throw new RangeError(`Coordinate ${value} 无法量化到 Int32（1e7 精度）。`)
  }
  return quantized
}

function writeU32(buffer, offset, value) {
  buffer.writeUInt32LE(value, offset)
}

function writeI32(buffer, offset, value) {
  buffer.writeInt32LE(value, offset)
}

function writeF32(buffer, offset, value) {
  buffer.writeFloatLE(value, offset)
}

export function buildBinaryGraph(graphPayload, shadePayload) {
  const { nodes, edges } = graphPayload
  const nodeEntries = Object.entries(nodes)
  const nodeCount = nodeEntries.length
  const edgeCount = edges.length

  const hasShade = shadePayload !== null && shadePayload !== undefined
  if (hasShade && edgeCount !== shadePayload.metadata.edgeCount) {
    throw new Error('Shade 与 Graph 的 Edge 数量不匹配。')
  }

  const nodeIndexById = new Map()
  const nodeLonQ = new Int32Array(nodeCount)
  const nodeLatQ = new Int32Array(nodeCount)
  nodeEntries.forEach(([nodeId, node], index) => {
    nodeIndexById.set(nodeId, index)
    nodeLonQ[index] = quantize(node.lon)
    nodeLatQ[index] = quantize(node.lat)
  })

  const edgeSource = new Int32Array(edgeCount)
  const edgeTarget = new Int32Array(edgeCount)
  const edgeLength = new Float32Array(edgeCount)
  const edgeGreen = new Float32Array(edgeCount)
  const edgeWater = new Float32Array(edgeCount)

  const pointCounts = new Int32Array(edgeCount)
  let pointCount = 0
  edges.forEach((edge, index) => {
    const sourceIndex = nodeIndexById.get(edge.source)
    const targetIndex = nodeIndexById.get(edge.target)
    if (sourceIndex === undefined || targetIndex === undefined) {
      throw new Error(`Edge ${edge.id} 引用了不存在的 Node。`)
    }
    edgeSource[index] = sourceIndex
    edgeTarget[index] = targetIndex
    edgeLength[index] = edge.length
    edgeGreen[index] = edge.green_score
    edgeWater[index] = edge.water_penalty
    pointCounts[index] = edge.geometry.length
    pointCount += edge.geometry.length
  })

  const geometryOffset = new Uint32Array(edgeCount + 1)
  const geomLonQ = new Int32Array(pointCount)
  const geomLatQ = new Int32Array(pointCount)
  let cursor = 0
  edges.forEach((edge, index) => {
    geometryOffset[index] = cursor
    for (const [lon, lat] of edge.geometry) {
      geomLonQ[cursor] = quantize(lon)
      geomLatQ[cursor] = quantize(lat)
      cursor += 1
    }
  })
  geometryOffset[edgeCount] = cursor
  if (cursor !== pointCount) throw new Error('Geometry 点数不一致。')

  // 无阴影模式：scenarioCount = 0，不写 shade 段（Worker 会走 base-only 路由）。
  const scenarioCount = hasShade ? SCENARIOS.length : 0
  const shade = new Float32Array(edgeCount * scenarioCount)
  if (hasShade) {
    const edgeIndexById = new Map(edges.map((edge, index) => [edge.id, index]))
    for (const [edgeId, values] of Object.entries(shadePayload.edgeShadeScores)) {
      const edgeIndex = edgeIndexById.get(edgeId)
      if (edgeIndex === undefined) throw new Error(`Shade Edge ${edgeId} 不在 Graph 中。`)
      values.forEach((score, scenarioIndex) => {
        shade[edgeIndex * scenarioCount + scenarioIndex] = score
      })
    }
  }

  const headerSize = 24
  const nodesSize = nodeCount * 8
  const edgesSize = edgeCount * 20
  const geometryOffsetSize = (edgeCount + 1) * 4
  const geometrySize = pointCount * 8
  const shadeSize = edgeCount * scenarioCount * 4
  const totalSize = headerSize + nodesSize + edgesSize + geometryOffsetSize + geometrySize + shadeSize

  const buffer = Buffer.allocUnsafe(totalSize)
  buffer.writeUInt32LE(MAGIC, 0)
  writeU32(buffer, 4, VERSION)
  writeU32(buffer, 8, nodeCount)
  writeU32(buffer, 12, edgeCount)
  writeU32(buffer, 16, pointCount)
  writeU32(buffer, 20, scenarioCount)

  let offset = headerSize
  for (let i = 0; i < nodeCount; i += 1) {
    writeI32(buffer, offset, nodeLonQ[i])
    writeI32(buffer, offset + 4, nodeLatQ[i])
    offset += 8
  }
  for (let i = 0; i < edgeCount; i += 1) {
    writeI32(buffer, offset, edgeSource[i])
    writeI32(buffer, offset + 4, edgeTarget[i])
    writeF32(buffer, offset + 8, edgeLength[i])
    writeF32(buffer, offset + 12, edgeGreen[i])
    writeF32(buffer, offset + 16, edgeWater[i])
    offset += 20
  }
  for (let i = 0; i <= edgeCount; i += 1) {
    writeU32(buffer, offset, geometryOffset[i])
    offset += 4
  }
  for (let i = 0; i < pointCount; i += 1) {
    writeI32(buffer, offset, geomLonQ[i])
    writeI32(buffer, offset + 4, geomLatQ[i])
    offset += 8
  }
  for (let i = 0; i < edgeCount * scenarioCount; i += 1) {
    writeF32(buffer, offset, shade[i])
    offset += 4
  }
  if (offset !== totalSize) throw new Error('二进制图大小不一致。')

  return {
    buffer,
    stats: {
      nodeCount,
      edgeCount,
      pointCount,
      scenarioCount,
      totalBytes: totalSize,
      gzipBytes: gzipSync(buffer).length,
    },
  }
}

async function main() {
  const noShade = process.env.CR_NO_SHADE === '1'
  const [graphPayload, shadePayload] = await Promise.all([
    readFile(GRAPH_URL, 'utf8').then(JSON.parse),
    noShade ? Promise.resolve(null) : readFile(SHADE_URL, 'utf8').then(JSON.parse),
  ])
  const { buffer, stats } = buildBinaryGraph(graphPayload, shadePayload)

  const outputDirectory = path.dirname(fileURLToPath(OUTPUT_URL))
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(OUTPUT_URL, buffer)
  await writeFile(OUTPUT_GZ_URL, gzipSync(buffer, { level: 9 }))
  if (!noShade) {
    await writeFile(
      SHADE_METADATA_URL,
      `${JSON.stringify({
        schemaVersion: shadePayload.metadata.schemaVersion,
        scenarios: shadePayload.metadata.scenarios,
        edgeCount: shadePayload.metadata.edgeCount,
        quality: shadePayload.metadata.quality ?? null,
        generatedAt: shadePayload.metadata.generatedAt,
      }, null, 2)}\n`,
    )
  }

  const graphBytes = (await stat(GRAPH_URL)).size
  console.log(JSON.stringify({
    graphJsonMB: +(graphBytes / 1048576).toFixed(1),
    shadeJsonMB: noShade ? 0 : +(stats.totalBytes / 1048576).toFixed(1),
    ...stats,
    binaryMB: +(stats.totalBytes / 1048576).toFixed(1),
    gzipMB: +(stats.gzipBytes / 1048576).toFixed(1),
    noShade,
    reductionVsJson: `${Math.round(100 * (1 - stats.totalBytes / graphBytes))}%`,
    outputs: [fileURLToPath(OUTPUT_URL), fileURLToPath(OUTPUT_GZ_URL)],
  }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
