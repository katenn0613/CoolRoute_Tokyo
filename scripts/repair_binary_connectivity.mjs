#!/usr/bin/env node
import { gzipSync } from 'node:zlib'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { decodeBinaryGraph } from '../src/routing/binaryGraph.js'
import { distanceMeters } from '../src/routing/nearestNode.js'

const GRAPH_URL = new URL('../public/data/graph_tokyo23.bin', import.meta.url)
const GRAPH_GZIP_URL = new URL('../public/data/graph_tokyo23.bin.gz', import.meta.url)
const METADATA_URL = new URL('../public/data/shade_metadata_tokyo23.json', import.meta.url)
const REPORT_URL = new URL('../public/data/topology_repair_tokyo23.json', import.meta.url)
const MAGIC = 0x52434752
const VERSION = 1
const COORDINATE_SCALE = 1e7
const MAJOR_COMPONENT_MINIMUM_NODES = 1_000
const SEARCH_GRID_DEGREES = 0.001

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

function buildComponents(graph) {
  const parent = new Int32Array(graph.nodeCount)
  const size = new Int32Array(graph.nodeCount)
  for (let index = 0; index < graph.nodeCount; index += 1) {
    parent[index] = index
    size[index] = 1
  }
  const find = (value) => {
    let cursor = value
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]]
      cursor = parent[cursor]
    }
    return cursor
  }
  const union = (first, second) => {
    let firstRoot = find(first)
    let secondRoot = find(second)
    if (firstRoot === secondRoot) return
    if (size[firstRoot] < size[secondRoot]) [firstRoot, secondRoot] = [secondRoot, firstRoot]
    parent[secondRoot] = firstRoot
    size[firstRoot] += size[secondRoot]
  }
  for (let edgeIndex = 0; edgeIndex < graph.edgeCount; edgeIndex += 1) {
    union(graph.edgeSource[edgeIndex], graph.edgeTarget[edgeIndex])
  }
  const rootByNode = new Int32Array(graph.nodeCount)
  const componentSizes = new Map()
  for (let nodeIndex = 0; nodeIndex < graph.nodeCount; nodeIndex += 1) {
    const root = find(nodeIndex)
    rootByNode[nodeIndex] = root
    componentSizes.set(root, (componentSizes.get(root) ?? 0) + 1)
  }
  return { rootByNode, componentSizes }
}

function closestMajorComponentPairs(graph, rootByNode, majorRoots) {
  const componentIndex = new Map(majorRoots.map((root, index) => [root, index]))
  const grid = new Map()
  const closestByPair = new Map()
  for (let nodeIndex = 0; nodeIndex < graph.nodeCount; nodeIndex += 1) {
    const component = componentIndex.get(rootByNode[nodeIndex])
    if (component === undefined) continue
    const x = Math.floor(graph.nodeLon[nodeIndex] / SEARCH_GRID_DEGREES)
    const y = Math.floor(graph.nodeLat[nodeIndex] / SEARCH_GRID_DEGREES)
    for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
      for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
        const candidates = grid.get(`${x + deltaX},${y + deltaY}`) ?? []
        for (const otherNodeIndex of candidates) {
          const otherComponent = componentIndex.get(rootByNode[otherNodeIndex])
          if (component === otherComponent) continue
          const firstComponent = Math.min(component, otherComponent)
          const secondComponent = Math.max(component, otherComponent)
          const pairKey = `${firstComponent}:${secondComponent}`
          const length = distanceMeters(
            [graph.nodeLon[nodeIndex], graph.nodeLat[nodeIndex]],
            [graph.nodeLon[otherNodeIndex], graph.nodeLat[otherNodeIndex]],
          )
          const existing = closestByPair.get(pairKey)
          if (!existing || length < existing.length) {
            closestByPair.set(pairKey, {
              firstComponent,
              secondComponent,
              firstNode: nodeIndex,
              secondNode: otherNodeIndex,
              length,
            })
          }
        }
      }
    }
    const gridKey = `${x},${y}`
    if (!grid.has(gridKey)) grid.set(gridKey, [])
    grid.get(gridKey).push(nodeIndex)
  }
  return [...closestByPair.values()]
}

function minimumSpanningBridges(componentCount, candidates) {
  const parent = new Int32Array(componentCount)
  for (let index = 0; index < componentCount; index += 1) parent[index] = index
  const find = (value) => {
    let cursor = value
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]]
      cursor = parent[cursor]
    }
    return cursor
  }
  const bridges = []
  for (const candidate of candidates.sort((first, second) => first.length - second.length)) {
    const firstRoot = find(candidate.firstComponent)
    const secondRoot = find(candidate.secondComponent)
    if (firstRoot === secondRoot) continue
    parent[secondRoot] = firstRoot
    bridges.push(candidate)
  }
  if (bridges.length !== componentCount - 1) {
    throw new Error(`主要组件无法通过近邻候选连接：需要 ${componentCount - 1} 组，实际 ${bridges.length} 组。`)
  }
  return bridges
}

function deriveBridgeEnvironment(graph, bridges) {
  const endpointIndices = new Set(bridges.flatMap((bridge) => [bridge.firstNode, bridge.secondNode]))
  const totals = new Map([...endpointIndices].map((nodeIndex) => [nodeIndex, {
    count: 0,
    green: 0,
    water: 0,
    shade: new Float64Array(graph.scenarioCount),
  }]))
  for (let edgeIndex = 0; edgeIndex < graph.edgeCount; edgeIndex += 1) {
    const endpoints = new Set([graph.edgeSource[edgeIndex], graph.edgeTarget[edgeIndex]])
    for (const nodeIndex of endpoints) {
      const total = totals.get(nodeIndex)
      if (!total) continue
      total.count += 1
      total.green += graph.edgeGreen[edgeIndex]
      total.water += graph.edgeWater[edgeIndex]
      for (let scenario = 0; scenario < graph.scenarioCount; scenario += 1) {
        total.shade[scenario] += graph.shade[edgeIndex * graph.scenarioCount + scenario]
      }
    }
  }
  const average = (nodeIndex) => {
    const total = totals.get(nodeIndex)
    if (!total?.count) throw new Error(`连接端点 ${nodeIndex} 没有相邻 Edge。`)
    return {
      green: total.green / total.count,
      water: total.water / total.count,
      shade: Array.from(total.shade, (value) => value / total.count),
    }
  }
  return bridges.map((bridge) => {
    const first = average(bridge.firstNode)
    const second = average(bridge.secondNode)
    return {
      ...bridge,
      green: clamp01((first.green + second.green) / 2),
      water: clamp01((first.water + second.water) / 2),
      shade: first.shade.map((value, scenario) => clamp01((value + second.shade[scenario]) / 2)),
    }
  })
}

function quantize(value) {
  return Math.round(value * COORDINATE_SCALE)
}

function encodeWithBridges(graph, bridges) {
  const bridgeDirections = bridges.flatMap((bridge) => [
    { ...bridge, source: bridge.firstNode, target: bridge.secondNode },
    { ...bridge, source: bridge.secondNode, target: bridge.firstNode },
  ])
  const edgeCount = graph.edgeCount + bridgeDirections.length
  const pointCount = graph.pointCount + bridgeDirections.length * 2
  const totalSize = 24
    + graph.nodeCount * 8
    + edgeCount * 20
    + (edgeCount + 1) * 4
    + pointCount * 8
    + edgeCount * graph.scenarioCount * 4
  const output = Buffer.allocUnsafe(totalSize)
  output.writeUInt32LE(MAGIC, 0)
  output.writeUInt32LE(VERSION, 4)
  output.writeUInt32LE(graph.nodeCount, 8)
  output.writeUInt32LE(edgeCount, 12)
  output.writeUInt32LE(pointCount, 16)
  output.writeUInt32LE(graph.scenarioCount, 20)
  let offset = 24
  for (let nodeIndex = 0; nodeIndex < graph.nodeCount; nodeIndex += 1) {
    output.writeInt32LE(quantize(graph.nodeLon[nodeIndex]), offset)
    output.writeInt32LE(quantize(graph.nodeLat[nodeIndex]), offset + 4)
    offset += 8
  }
  for (let edgeIndex = 0; edgeIndex < graph.edgeCount; edgeIndex += 1) {
    output.writeInt32LE(graph.edgeSource[edgeIndex], offset)
    output.writeInt32LE(graph.edgeTarget[edgeIndex], offset + 4)
    output.writeFloatLE(graph.edgeLength[edgeIndex], offset + 8)
    output.writeFloatLE(graph.edgeGreen[edgeIndex], offset + 12)
    output.writeFloatLE(graph.edgeWater[edgeIndex], offset + 16)
    offset += 20
  }
  for (const bridge of bridgeDirections) {
    output.writeInt32LE(bridge.source, offset)
    output.writeInt32LE(bridge.target, offset + 4)
    output.writeFloatLE(bridge.length, offset + 8)
    output.writeFloatLE(bridge.green, offset + 12)
    output.writeFloatLE(bridge.water, offset + 16)
    offset += 20
  }
  for (let edgeIndex = 0; edgeIndex <= graph.edgeCount; edgeIndex += 1) {
    output.writeUInt32LE(graph.geometryOffset[edgeIndex], offset)
    offset += 4
  }
  let geometryCursor = graph.pointCount
  for (let bridgeIndex = 0; bridgeIndex < bridgeDirections.length; bridgeIndex += 1) {
    geometryCursor += 2
    output.writeUInt32LE(geometryCursor, offset)
    offset += 4
  }
  for (let pointIndex = 0; pointIndex < graph.pointCount; pointIndex += 1) {
    output.writeInt32LE(quantize(graph.geomLon[pointIndex]), offset)
    output.writeInt32LE(quantize(graph.geomLat[pointIndex]), offset + 4)
    offset += 8
  }
  for (const bridge of bridgeDirections) {
    for (const nodeIndex of [bridge.source, bridge.target]) {
      output.writeInt32LE(quantize(graph.nodeLon[nodeIndex]), offset)
      output.writeInt32LE(quantize(graph.nodeLat[nodeIndex]), offset + 4)
      offset += 8
    }
  }
  for (const value of graph.shade) {
    output.writeFloatLE(value, offset)
    offset += 4
  }
  for (const bridge of bridgeDirections) {
    for (const value of bridge.shade) {
      output.writeFloatLE(value, offset)
      offset += 4
    }
  }
  if (offset !== totalSize) throw new Error(`二进制写入大小不一致：${offset} != ${totalSize}`)
  return output
}

async function atomicWrite(url, data) {
  const target = fileURLToPath(url)
  const temporary = `${target}.tmp`
  await writeFile(temporary, data)
  await rename(temporary, target)
}

async function main() {
  const metadata = JSON.parse(await readFile(METADATA_URL, 'utf8'))
  if (metadata.topologyRepair?.method === 'major-component-nearest-boundary-bridges') {
    console.log(JSON.stringify({ status: 'skipped', reason: 'topology repair already applied' }))
    return
  }
  const source = await readFile(GRAPH_URL)
  const graph = decodeBinaryGraph(source)
  const { rootByNode, componentSizes } = buildComponents(graph)
  const majorRoots = [...componentSizes.entries()]
    .filter(([, size]) => size >= MAJOR_COMPONENT_MINIMUM_NODES)
    .sort((first, second) => second[1] - first[1])
    .map(([root]) => root)
  const candidates = closestMajorComponentPairs(graph, rootByNode, majorRoots)
  const bridges = deriveBridgeEnvironment(
    graph,
    minimumSpanningBridges(majorRoots.length, candidates),
  )
  const output = encodeWithBridges(graph, bridges)
  metadata.edgeCount = graph.edgeCount + bridges.length * 2
  metadata.topologyRepair = {
    method: 'major-component-nearest-boundary-bridges',
    majorComponentMinimumNodes: MAJOR_COMPONENT_MINIMUM_NODES,
    originalWeakComponentCount: componentSizes.size,
    originalMajorComponentCount: majorRoots.length,
    bidirectionalBridgeCount: bridges.length,
    directedDerivedEdgeCount: bridges.length * 2,
    environmentalFallback: 'mean-of-incident-endpoint-edges',
  }
  const report = {
    schemaVersion: '1.0.0',
    dataset: 'OpenStreetMap-derived Tokyo23 browser graph',
    purpose: 'Hackathon-stage repair of ward-boundary topology discontinuities',
    originalNodeCount: graph.nodeCount,
    originalEdgeCount: graph.edgeCount,
    repairedEdgeCount: metadata.edgeCount,
    originalWeakComponentCount: componentSizes.size,
    majorComponentMinimumNodes: MAJOR_COMPONENT_MINIMUM_NODES,
    majorComponentCount: majorRoots.length,
    remainingSmallComponentCount: componentSizes.size - majorRoots.length,
    bridgePolicy: 'minimum spanning connections between geographically nearest major-component nodes',
    limitations: 'Derived bridges improve cross-ward reachability but do not prove complete real-world topology.',
    bridges: bridges.map((bridge, index) => ({
      id: `derived-boundary-bridge-${String(index + 1).padStart(2, '0')}`,
      bidirectional: true,
      lengthMeters: Number(bridge.length.toFixed(3)),
      source: [graph.nodeLon[bridge.firstNode], graph.nodeLat[bridge.firstNode]],
      target: [graph.nodeLon[bridge.secondNode], graph.nodeLat[bridge.secondNode]],
    })),
  }
  await atomicWrite(GRAPH_URL, output)
  await atomicWrite(GRAPH_GZIP_URL, gzipSync(output, { level: 9 }))
  await atomicWrite(METADATA_URL, `${JSON.stringify(metadata, null, 2)}\n`)
  await atomicWrite(REPORT_URL, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({
    nodeCount: graph.nodeCount,
    originalEdgeCount: graph.edgeCount,
    repairedEdgeCount: metadata.edgeCount,
    originalWeakComponentCount: componentSizes.size,
    connectedMajorComponentCount: majorRoots.length,
    bidirectionalBridgeCount: bridges.length,
    maximumBridgeLengthMeters: Math.max(...bridges.map((bridge) => bridge.length)),
    outputBytes: output.byteLength,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
