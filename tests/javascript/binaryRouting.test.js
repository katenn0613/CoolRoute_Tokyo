import { describe, expect, it } from 'vitest'

import {
  decodeBinaryGraph,
  edgeGeometry,
  edgeShadeScore,
  materializeEdge,
} from '../../src/routing/binaryGraph.js'
import {
  buildAdjacency,
  findNearestNodeBinary,
  weightedDijkstraBinary,
} from '../../src/routing/binaryRouting.js'

const NODES = [
  [139.75, 35.68],
  [139.751, 35.681],
  [139.75, 35.682],
  [139.753, 35.682],
]

const EDGES = [
  { source: 0, target: 1, length: 2, green: 0, water: 1, geometry: [[139.75, 35.68], [139.751, 35.681]], shade: [0, 1, 0] },
  { source: 0, target: 1, length: 10, green: 0, water: 1, geometry: [[139.75, 35.68], [139.7505, 35.6805], [139.751, 35.681]], shade: [0, 1, 0] },
  { source: 1, target: 3, length: 5, green: 0, water: 1, geometry: [[139.751, 35.681], [139.753, 35.682]], shade: [0, 1, 0] },
  { source: 0, target: 2, length: 4, green: 1, water: 0, geometry: [[139.75, 35.68], [139.75, 35.682]], shade: [1, 0, 1] },
  { source: 2, target: 3, length: 10, green: 1, water: 0, geometry: [[139.75, 35.682], [139.753, 35.682]], shade: [1, 0, 1] },
]

function fixtureBinary() {
  const points = EDGES.flatMap((edge) => edge.geometry)
  const byteLength = 24
    + NODES.length * 8
    + EDGES.length * 20
    + (EDGES.length + 1) * 4
    + points.length * 8
    + EDGES.length * 3 * 4
  const buffer = new ArrayBuffer(byteLength)
  const view = new DataView(buffer)
  const coordinate = (value) => Math.round(value * 1e7)
  view.setUint32(0, 0x52434752, true)
  view.setUint32(4, 1, true)
  view.setUint32(8, NODES.length, true)
  view.setUint32(12, EDGES.length, true)
  view.setUint32(16, points.length, true)
  view.setUint32(20, 3, true)
  let offset = 24
  for (const [lon, lat] of NODES) {
    view.setInt32(offset, coordinate(lon), true)
    view.setInt32(offset + 4, coordinate(lat), true)
    offset += 8
  }
  for (const edge of EDGES) {
    view.setInt32(offset, edge.source, true)
    view.setInt32(offset + 4, edge.target, true)
    view.setFloat32(offset + 8, edge.length, true)
    view.setFloat32(offset + 12, edge.green, true)
    view.setFloat32(offset + 16, edge.water, true)
    offset += 20
  }
  let pointOffset = 0
  for (const edge of EDGES) {
    view.setUint32(offset, pointOffset, true)
    pointOffset += edge.geometry.length
    offset += 4
  }
  view.setUint32(offset, pointOffset, true)
  offset += 4
  for (const [lon, lat] of points) {
    view.setInt32(offset, coordinate(lon), true)
    view.setInt32(offset + 4, coordinate(lat), true)
    offset += 8
  }
  for (const edge of EDGES) {
    for (const shade of edge.shade) {
      view.setFloat32(offset, shade, true)
      offset += 4
    }
  }
  return buffer
}

describe('Binary Graph Schema', () => {
  it('decodes nodes, MultiEdges, environment values, geometry and shade', () => {
    const graph = decodeBinaryGraph(fixtureBinary())
    expect(graph.nodeCount).toBe(4)
    expect(graph.edgeCount).toBe(5)
    expect(graph.scenarioCount).toBe(3)
    expect(edgeGeometry(graph, 1)).toHaveLength(3)
    expect(edgeShadeScore(graph, 0, '12:00')).toBe(1)
    expect(materializeEdge(graph, 3)).toMatchObject({
      id: '3', source: '0', target: '2', length: 4,
      green_score: 1, water_penalty: 0,
    })
  })

  it('rejects invalid magic and truncated payloads', () => {
    const wrongMagic = fixtureBinary()
    new DataView(wrongMagic).setUint32(0, 0, true)
    expect(() => decodeBinaryGraph(wrongMagic)).toThrow(/magic/)
    expect(() => decodeBinaryGraph(fixtureBinary().slice(0, -4))).toThrow(/大小/)
  })
})

describe('Binary Routing', () => {
  const graph = decodeBinaryGraph(fixtureBinary())
  const adjacency = buildAdjacency(graph)

  it('retains the shorter of parallel directed edges for Fastest', () => {
    const route = weightedDijkstraBinary(graph, adjacency, 0, 3, {
      mode: 'fastest', scenario: '12:00',
    })
    expect(route.found).toBe(true)
    expect(route.edgeSequence).toEqual([0, 2])
    expect(route.totalDistance).toBe(7)
  })

  it('uses shade-aware exposure for Balanced and Coolest', () => {
    const midday = weightedDijkstraBinary(graph, adjacency, 0, 3, {
      mode: 'coolest', scenario: '12:00',
    })
    const afternoon = weightedDijkstraBinary(graph, adjacency, 0, 3, {
      mode: 'coolest', scenario: '15:00',
    })
    expect(midday.edgeSequence).toEqual([0, 2])
    expect(afternoon.edgeSequence).toEqual([3, 4])
  })

  it('returns unreachable without throwing for different components', () => {
    const route = weightedDijkstraBinary(graph, adjacency, 3, 0, {
      mode: 'fastest', scenario: '12:00',
    })
    expect(route).toMatchObject({ found: false, edgeSequence: [], nodeSequence: [] })
  })

  it('snaps to the nearest valid node and rejects a remote click', () => {
    const snapped = findNearestNodeBinary(graph, [139.7501, 35.6801], {
      boundingBox: [139.7, 35.6, 139.8, 35.75], maximumDistanceMeters: 200,
    })
    expect(snapped.index).toBe(0)
    expect(() => findNearestNodeBinary(graph, [139.79, 35.74], {
      boundingBox: [139.7, 35.6, 139.8, 35.75], maximumDistanceMeters: 200,
    })).toThrow(/200/)
  })
})
