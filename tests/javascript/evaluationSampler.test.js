import { describe, expect, it } from 'vitest'

import {
  classifyFastestDistance,
  createSeededRandom,
  sampleStratifiedOdPairs,
  straightDistanceMeters,
} from '../../scripts/evaluation/sampler.mjs'

function createNodes(order = 'ascending') {
  const nodes = Array.from({ length: 120 }, (_, index) => {
    const id = `node-${String(index).padStart(3, '0')}`
    return [id, { id, lon: 139.74 + index * 0.001, lat: 35.68 }]
  })
  if (order === 'descending') nodes.reverse()
  return new Map(nodes)
}

function fastestDistanceForPair(startId, destinationId) {
  const startIndex = Number(startId.slice(-3))
  const destinationIndex = Number(destinationId.slice(-3))
  const gap = Math.abs(startIndex - destinationIndex)
  if (gap <= 10) return 700
  if (gap <= 17) return 1500
  return 2500
}

function routeWith(distanceMeters, edgeId, averageHeatExposure = 0.5) {
  return {
    result: { edgeSequence: [{ id: edgeId }], totalCost: distanceMeters },
    metrics: {
      distanceMeters,
      walkingTimeSeconds: distanceMeters / 1.4,
      edgeCount: 1,
      averageHeatExposure,
      modelledExposureLoad: distanceMeters * averageHeatExposure,
      greenIndicator: 0.2,
      waterAccessIndicator: 0.4,
    },
  }
}

function createBundleCalculator({ invertOutcomes = false } = {}) {
  return (_graph, startId, destinationId) => {
    const fastestDistance = fastestDistanceForPair(startId, destinationId)
    const routeIndex = Number(startId.slice(-3)) + Number(destinationId.slice(-3))
    const alternate = routeIndex % 2 === 0
    const outcome = invertOutcomes ? !alternate : alternate
    return {
      routes: {
        fastest: routeWith(fastestDistance, 'fastest', 0.6),
        balanced: routeWith(fastestDistance + (outcome ? 0 : 100), outcome ? 'fastest' : 'balanced', outcome ? 0.7 : 0.4),
        coolest: routeWith(fastestDistance + (outcome ? 250 : 0), outcome ? 'coolest' : 'fastest', outcome ? 0.3 : 0.8),
      },
      comparisons: {},
    }
  }
}

function graphWithNodes(order = 'ascending') {
  return { nodes: createNodes(order) }
}

function compactCases(sample) {
  return sample.cases.map(({ start, destination, stratum }) => [start.id, destination.id, stratum])
}

describe('M7 deterministic stratified OD sampler', () => {
  it('uses a reproducible seeded random sequence', () => {
    const first = createSeededRandom(20260821)
    const second = createSeededRandom(20260821)
    const other = createSeededRandom(20260822)
    const firstSequence = Array.from({ length: 5 }, () => first())
    expect(Array.from({ length: 5 }, () => second())).toEqual(firstSequence)
    expect(Array.from({ length: 5 }, () => other())).not.toEqual(firstSequence)
  })

  it('computes real-world straight distance in meters', () => {
    expect(straightDistanceMeters(
      { lon: 139.75, lat: 35.68 },
      { lon: 139.751, lat: 35.68 },
    )).toBeCloseTo(90.3, 0)
  })

  it('assigns every Fastest distance boundary to exactly one stratum', () => {
    expect(classifyFastestDistance(399.999)).toBeNull()
    expect(classifyFastestDistance(400)).toBe('short')
    expect(classifyFastestDistance(999.999)).toBe('short')
    expect(classifyFastestDistance(1000)).toBe('medium')
    expect(classifyFastestDistance(1999.999)).toBe('medium')
    expect(classifyFastestDistance(2000)).toBe('long')
    expect(classifyFastestDistance(3500)).toBe('long')
    expect(classifyFastestDistance(3500.001)).toBeNull()
  })

  it('produces the same 30/30/30 directed OD sample regardless of Map insertion order', () => {
    const options = {
      calculateBundle: createBundleCalculator(),
      seed: 20260821,
      targetPerStratum: 30,
      maximumAttempts: 100000,
    }
    const ascending = sampleStratifiedOdPairs({ graph: graphWithNodes(), ...options })
    const descending = sampleStratifiedOdPairs({ graph: graphWithNodes('descending'), ...options })

    expect(compactCases(descending)).toEqual(compactCases(ascending))
    expect(ascending.audit.acceptedByStratum).toEqual({ short: 30, medium: 30, long: 30 })
    expect(new Set(ascending.cases.map(({ start, destination }) => `${start.id}->${destination.id}`)).size).toBe(90)
  })

  it('changes the accepted OD sequence when the seed changes', () => {
    const common = {
      graph: graphWithNodes(),
      calculateBundle: createBundleCalculator(),
      targetPerStratum: 3,
      maximumAttempts: 10000,
    }
    const first = sampleStratifiedOdPairs({ ...common, seed: 20260821 })
    const second = sampleStratifiedOdPairs({ ...common, seed: 20260822 })
    expect(compactCases(second)).not.toEqual(compactCases(first))
  })

  it('does not use route equality or exposure outcomes to accept candidates', () => {
    const common = {
      graph: graphWithNodes(),
      seed: 20260821,
      targetPerStratum: 5,
      maximumAttempts: 10000,
    }
    const original = sampleStratifiedOdPairs({ ...common, calculateBundle: createBundleCalculator() })
    const inverted = sampleStratifiedOdPairs({
      ...common,
      calculateBundle: createBundleCalculator({ invertOutcomes: true }),
    })
    expect(compactCases(inverted)).toEqual(compactCases(original))
  })

  it('fails explicitly rather than publishing a partial sample', () => {
    expect(() => sampleStratifiedOdPairs({
      graph: graphWithNodes(),
      calculateBundle: () => ({ routes: { fastest: routeWith(200, 'too-short') }, comparisons: {} }),
      seed: 20260821,
      targetPerStratum: 1,
      maximumAttempts: 20,
    })).toThrow(/OD 分层抽样不足/)
  })
})
