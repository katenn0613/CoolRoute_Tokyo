import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildBinaryGraph } from '../../scripts/build_binary_graph.mjs'
import {
  decodeBinaryGraph,
  edgeGeometry,
  edgeShadeScore,
  materializeEdge,
  scenarioIndex,
} from '../../src/routing/binaryGraph.js'
import {
  buildAdjacency,
  edgeCost,
  findNearestNodeBinary,
  weightedDijkstraBinary,
} from '../../src/routing/binaryRouting.js'
import { findShortestPath, weightedDijkstra } from '../../src/routing/dijkstra.js'
import { ROUTING_MODES, createEdgeWeightFunction } from '../../src/routing/exposureModel.js'
import { prepareGraph } from '../../src/routing/graphLoader.js'
import { findNearestNode } from '../../src/routing/nearestNode.js'
import { createShadeContext } from '../../src/routing/shadeContext.js'
import { routingConfig } from '../../src/config/routingConfig.js'

function syntheticPayload() {
  const nodes = {
    a: { id: 'a', lon: 139.75, lat: 35.68 },
    b: { id: 'b', lon: 139.751, lat: 35.681 },
    c: { id: 'c', lon: 139.75, lat: 35.682 },
    d: { id: 'd', lon: 139.753, lat: 35.682 },
  }
  const edges = [
    {
      id: 'a:b:slow', source: 'a', target: 'b', length: 10,
      green_score: 0, water_penalty: 1,
      geometry: [[139.75, 35.68], [139.751, 35.681]],
    },
    {
      id: 'a:b:fast', source: 'a', target: 'b', length: 2,
      green_score: 0, water_penalty: 1,
      geometry: [[139.75, 35.68], [139.7505, 35.6805], [139.751, 35.681]],
    },
    {
      id: 'b:d:0', source: 'b', target: 'd', length: 5,
      green_score: 0, water_penalty: 1,
      geometry: [[139.751, 35.681], [139.752, 35.6815], [139.753, 35.682]],
    },
    {
      id: 'a:c:0', source: 'a', target: 'c', length: 4,
      green_score: 1, water_penalty: 0,
      geometry: [[139.75, 35.68], [139.75, 35.682]],
    },
    {
      id: 'c:d:0', source: 'c', target: 'd', length: 10,
      green_score: 1, water_penalty: 0,
      geometry: [[139.75, 35.682], [139.753, 35.682]],
    },
  ]
  return {
    metadata: {
      graphVersion: '1.1.0',
      generatedAt: 'parity-baseline',
      nodeCount: 4,
      edgeCount: 5,
    },
    nodes,
    edges,
  }
}

function syntheticShade() {
  return {
    metadata: {
      schemaVersion: '1.0.0',
      scenarios: ['09:00', '12:00', '15:00'],
      roadGraphSchemaVersion: '1.1.0',
      roadGraphGeneratedAt: 'parity-baseline',
      edgeCount: 5,
    },
    edgeShadeScores: {
      'a:b:slow': [0, 1, 0],
      'a:b:fast': [0, 1, 0],
      'b:d:0': [0, 1, 0],
      'a:c:0': [1, 0, 1],
      'c:d:0': [1, 0, 1],
    },
  }
}

const BBOX = [139.559, 35.528, 139.918, 35.818]

function buildBinary(payload, shadePayload) {
  const { buffer } = buildBinaryGraph(payload, shadePayload)
  const binary = decodeBinaryGraph(buffer)
  const adjacency = buildAdjacency(binary)
  return { binary, adjacency }
}

describe('二进制图解码与结构', () => {
  it('round-trip 后节点/边/几何与 JSON 一致（1e-7 精度内）', () => {
    const payload = syntheticPayload()
    const { binary } = buildBinary(payload, syntheticShade())
    expect(binary.nodeCount).toBe(4)
    expect(binary.edgeCount).toBe(5)
    expect(binary.scenarioCount).toBe(3)
    expect(binary.pointCount).toBe(12)

    const nodeIndexById = new Map(Object.keys(payload.nodes).map((id, index) => [id, index]))
    payload.edges.forEach((edge, index) => {
      const materialized = materializeEdge(binary, index)
      expect(materialized.source).toBe(String(nodeIndexById.get(edge.source)))
      expect(materialized.target).toBe(String(nodeIndexById.get(edge.target)))
      expect(materialized.length).toBeCloseTo(edge.length, 3)
      expect(materialized.green_score).toBeCloseTo(edge.green_score, 3)
      expect(materialized.water_penalty).toBeCloseTo(edge.water_penalty, 3)
      edge.geometry.forEach(([lon, lat], pointIndex) => {
        expect(materialized.geometry[pointIndex][0]).toBeCloseTo(lon, 6)
        expect(materialized.geometry[pointIndex][1]).toBeCloseTo(lat, 6)
      })
    })
  })

  it('edgeShadeScore 与 scenarioIndex 映射正确', () => {
    const { binary } = buildBinary(syntheticPayload(), syntheticShade())
    expect(scenarioIndex('12:00')).toBe(1)
    expect(edgeShadeScore(binary, 0, '12:00')).toBeCloseTo(1, 6)
    expect(edgeShadeScore(binary, 3, '12:00')).toBeCloseTo(0, 6)
    expect(() => scenarioIndex('06:00')).toThrow(/场景/)
  })

  it('邻接表覆盖所有边的出边', () => {
    const payload = syntheticPayload()
    const { binary, adjacency } = buildBinary(payload, syntheticShade())
    const sourceIndexById = new Map(
      Object.entries(payload.nodes).map(([id, node], index) => [id, index]),
    )
    for (const [edgeIndex, edge] of payload.edges.entries()) {
      const source = sourceIndexById.get(edge.source)
      const start = adjacency.offsets[source]
      const end = adjacency.offsets[source + 1]
      expect(adjacency.edgeList.slice(start, end)).toContain(edgeIndex)
    }
  })
})

describe('二进制路由与 legacy 对象路由一致性', () => {
  const payload = syntheticPayload()
  const shadePayload = syntheticShade()
  const legacyGraph = prepareGraph(payload)
  const { binary, adjacency } = buildBinary(payload, shadePayload)
  const nodeIndexById = new Map(Object.keys(payload.nodes).map((id, index) => [id, index]))
  const cases = [
    ['a', 'd'],
    ['b', 'c'],
    ['a', 'b'],
  ]
  const scenarios = [null, '09:00', '12:00', '15:00']

  for (const mode of Object.values(ROUTING_MODES)) {
    for (const scenario of scenarios) {
      for (const [from, to] of cases) {
        it(`${mode} ${scenario ?? '无阴影'} ${from}→${to} 结果一致`, () => {
          const shadeContext = scenario
            ? createShadeContext(shadePayload, scenario, routingConfig.shadeContributionWeight)
            : null
          const legacy = weightedDijkstra(
            legacyGraph,
            from,
            to,
            createEdgeWeightFunction(mode, routingConfig, shadeContext),
          )
          const binaryResult = weightedDijkstraBinary(
            binary,
            adjacency,
            nodeIndexById.get(from),
            nodeIndexById.get(to),
            { mode, scenario },
          )
          expect(binaryResult.found).toBe(legacy.found)
          expect(binaryResult.totalDistance).toBeCloseTo(legacy.totalDistance, 3)
          expect(binaryResult.totalCost).toBeCloseTo(legacy.totalCost, 5)
          expect(binaryResult.edgeSequence.length).toBe(legacy.edgeSequence.length)
        })
      }
    }
  }

  it('edgeCost 与 createEdgeWeightFunction 数学一致', () => {
    const shadeContext = createShadeContext(shadePayload, '12:00', routingConfig.shadeContributionWeight)
    for (const mode of Object.values(ROUTING_MODES)) {
      const weightFunction = createEdgeWeightFunction(mode, routingConfig, shadeContext)
      payload.edges.forEach((edge, index) => {
        const legacyWeight = weightFunction(edge)
        const binaryWeight = edgeCost(binary, index, { lambda: { fastest: 0, balanced: 1, coolest: 3 }[mode], scenario: '12:00' })
        expect(binaryWeight).toBeCloseTo(legacyWeight, 5)
      })
    }
  })

  it('吸附结果与 legacy findNearestNode 一致', () => {
    const point = [139.7503, 35.6804]
    const legacy = findNearestNode(legacyGraph, point, {
      boundingBox: BBOX,
      maximumDistanceMeters: 200,
    })
    const binaryResult = findNearestNodeBinary(binary, point, {
      boundingBox: BBOX,
      maximumDistanceMeters: 200,
    })
    expect(nodeIndexById.get(legacy.node.id)).toBe(binaryResult.index)
    expect(binaryResult.lon).toBeCloseTo(legacy.node.lon, 6)
    expect(binaryResult.distanceMeters).toBeCloseTo(legacy.distanceMeters, 3)
  })
})

describe('真实 Tokyo23 数据抽查（二进制与 JSON 结果一致）', () => {
  const binaryPath = path.resolve(process.cwd(), 'public/data/graph_tokyo23.bin')
  const graphPath = path.resolve(process.cwd(), 'public/data/graph_tokyo23.json')
  const available = existsSync(binaryPath) && existsSync(graphPath)

  it.skipIf(!available)('真实节点在三种模式下路径一致', async () => {
    const { readFile } = await import('node:fs/promises')
    const [buffer, graphText] = await Promise.all([
      readFile(binaryPath),
      readFile(graphPath, 'utf8'),
    ])
    const binary = decodeBinaryGraph(buffer)
    const adjacency = buildAdjacency(binary)
    const legacyGraph = prepareGraph(JSON.parse(graphText))
    const nodeIndexById = new Map([...legacyGraph.nodes.keys()].map((id, index) => [id, index]))
    const allIds = [...legacyGraph.nodes.keys()]
    const cases = [
      [allIds[0], allIds[50000]],
      [allIds[25000], allIds[100000]],
      [allIds[0], allIds[allIds.length - 1]],
    ]
    for (const mode of Object.values(ROUTING_MODES)) {
      for (const [fromId, toId] of cases) {
        const fromIndex = nodeIndexById.get(fromId)
        const toIndex = nodeIndexById.get(toId)
        const legacy = weightedDijkstra(
          legacyGraph,
          fromId,
          toId,
          createEdgeWeightFunction(mode, routingConfig, null),
        )
        const binaryResult = weightedDijkstraBinary(
          binary,
          adjacency,
          fromIndex,
          toIndex,
          { mode, scenario: null },
        )
        expect(binaryResult.found).toBe(legacy.found)
        if (legacy.found) {
          // Float32 存储 length 引入亚毫米级量化误差，属于可接受精度损失
          expect(binaryResult.totalDistance).toBeCloseTo(legacy.totalDistance, 1)
          expect(binaryResult.totalCost).toBeCloseTo(legacy.totalCost, 2)
          expect(binaryResult.edgeSequence.length).toBe(legacy.edgeSequence.length)
        }
      }
    }
  }, 120000)
})
