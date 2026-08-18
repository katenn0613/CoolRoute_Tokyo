import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { calculateRouteBundle } from '../../src/routing/calculateRouteBundle.js'
import { prepareGraph } from '../../src/routing/graphLoader.js'

const graph = prepareGraph(JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/data/graph.json'), 'utf8'),
))
const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/data/m5_route_cases.json'), 'utf8'),
)

describe('M5 可复现真实东京三模式案例', () => {
  it('contains five real cases with natural same and trade-off routes', () => {
    expect(fixture.metadata.seed).toBe(20260818)
    expect(fixture.metadata.edgeScoresModified).toBe(false)
    expect(fixture.cases).toHaveLength(5)
    expect(fixture.cases.filter((item) => item.fastestEqualsCoolest)).toHaveLength(2)
    expect(fixture.cases.filter((item) => !item.fastestEqualsCoolest)).toHaveLength(3)
  })

  it.each(fixture.cases)('$id can be reproduced from saved node IDs', (item) => {
    const bundle = calculateRouteBundle(graph, item.startNodeId, item.destinationNodeId)
    for (const mode of ['fastest', 'balanced', 'coolest']) {
      expect(bundle.routes[mode].result.edgeSequence.map((edge) => edge.id)).toEqual(
        item.routes[mode].edgeIds,
      )
      expect(bundle.routes[mode].metrics.distanceMeters).toBeCloseTo(
        item.routes[mode].distanceMeters, 8,
      )
      expect(bundle.routes[mode].metrics.averageHeatExposure).toBeCloseTo(
        item.routes[mode].averageHeatExposure, 10,
      )
      expect(bundle.routes[mode].metrics.modelledExposureLoad).toBeCloseTo(
        item.routes[mode].modelledExposureLoad, 8,
      )
    }
  })
})
