import { describe, expect, it } from 'vitest'
import { demoArea } from '../../src/config/demoArea.js'
import {
  NearestNodeError,
  PointOutsideDemoAreaError,
  findNearestNode,
  isPointInDemoArea,
} from '../../src/routing/nearestNode.js'
import { createSyntheticRoadGraph } from './fixtures/syntheticRoadGraph.js'

describe('Nearest Node', () => {
  it('returns the closest graph node and its metric distance', () => {
    const graph = createSyntheticRoadGraph()

    const result = findNearestNode(graph, [139.75001, 35.68001], {
      boundingBox: demoArea.boundingBox,
      maximumDistanceMeters: 200,
    })

    expect(result.node.id).toBe('a')
    expect(result.distanceMeters).toBeGreaterThan(0)
    expect(result.distanceMeters).toBeLessThan(2)
  })

  it('rejects a click outside the strict Demo Area before snapping', () => {
    const graph = createSyntheticRoadGraph()
    const outsidePoint = [demoArea.boundingBox[0] - 0.0001, 35.68]

    expect(isPointInDemoArea(outsidePoint, demoArea.boundingBox)).toBe(false)
    expect(() => findNearestNode(graph, outsidePoint, {
      boundingBox: demoArea.boundingBox,
      maximumDistanceMeters: 200,
    })).toThrow(PointOutsideDemoAreaError)
  })

  it('rejects an in-bounds click whose nearest road node exceeds the snap limit', () => {
    const graph = createSyntheticRoadGraph()

    expect(() => findNearestNode(graph, [139.745, 35.673], {
      boundingBox: demoArea.boundingBox,
      maximumDistanceMeters: 20,
    })).toThrow(NearestNodeError)
  })
})
