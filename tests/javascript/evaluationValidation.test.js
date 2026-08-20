import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { compareRouteToFastest } from '../../src/routing/routeComparison.js'
import { publishFilesTransactionally } from '../../scripts/evaluation/publisher.mjs'
import { createEvaluationSummary } from '../../scripts/evaluation/summary.mjs'
import {
  validateEvaluationResults,
  validateEvaluationSummary,
} from '../../scripts/evaluation/validation.mjs'

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const NODE_COORDINATES = {
  a: [139.75, 35.68],
  b: [139.751, 35.681],
  c: [139.752, 35.682],
}

function metrics(distanceMeters) {
  return {
    distanceMeters,
    walkingTimeSeconds: distanceMeters / 1.4,
    edgeCount: 1,
    averageHeatExposure: 0.74,
    modelledExposureLoad: distanceMeters * 0.74,
    greenIndicator: 0.2,
    waterAccessIndicator: 0.4,
  }
}

function route(mode, edgeId, distanceMeters) {
  const lambdas = { fastest: 0, balanced: 1, coolest: 3 }
  return {
    mode,
    ...metrics(distanceMeters),
    totalCost: distanceMeters * (1 + lambdas[mode] * 0.74),
    edgeIds: [edgeId],
  }
}

function evaluationCase(index, stratum, startId, destinationId, edgeId) {
  const distanceByStratum = { short: 500, medium: 1500, long: 2500 }
  const straightByStratum = { short: 450, medium: 1000, long: 1000 }
  const distanceMeters = distanceByStratum[stratum]
  const fastest = route('fastest', edgeId, distanceMeters)
  const balanced = route('balanced', edgeId, distanceMeters)
  const coolest = route('coolest', edgeId, distanceMeters)
  const baseComparison = {
    ...compareRouteToFastest(balanced, fastest),
    greenIndicatorChange: 0,
    waterAccessIndicatorChange: 0,
  }
  return {
    id: `m7-od-00${index}`,
    stratum,
    start: { nodeId: startId, coordinates: NODE_COORDINATES[startId] },
    destination: { nodeId: destinationId, coordinates: NODE_COORDINATES[destinationId] },
    straightDistanceMeters: straightByStratum[stratum],
    routes: { fastest, balanced, coolest },
    comparisons: { balanced: baseComparison, coolest: baseComparison },
    routeEquality: {
      fastestEqualsBalanced: true,
      fastestEqualsCoolest: true,
      balancedEqualsCoolest: true,
      allThreeEqual: true,
    },
  }
}

function graphFixture() {
  const nodes = new Map([
    ['a', { id: 'a', lon: 139.75, lat: 35.68 }],
    ['b', { id: 'b', lon: 139.751, lat: 35.681 }],
    ['c', { id: 'c', lon: 139.752, lat: 35.682 }],
  ])
  const edges = new Map([
    ['e1', { id: 'e1', source: 'a', target: 'b', length: 500, green_score: 0.2, water_penalty: 0.6 }],
    ['e2', { id: 'e2', source: 'b', target: 'c', length: 1500, green_score: 0.2, water_penalty: 0.6 }],
    ['e3', { id: 'e3', source: 'c', target: 'a', length: 2500, green_score: 0.2, water_penalty: 0.6 }],
  ])
  return { nodes, edges }
}

function resultsFixture() {
  return {
    metadata: {
      evaluationSchemaVersion: '1.0.0',
      graphSchemaVersion: '1.1.0',
      graphSha256: 'expected-hash',
      graphNodeCount: 3,
      graphEdgeCount: 3,
      demoArea: { id: 'demo', name: 'Demo', boundingBox: [139.7, 35.6, 139.8, 35.7] },
      seed: 20260821,
      samplingRules: {},
      routingConfig: {
        walkingSpeedMetersPerSecond: 1.4,
        greenWeight: 0.7,
        waterWeight: 0.3,
        balancedLambda: 1,
        coolestLambda: 3,
        maximumExtraDistanceRatio: null,
      },
      edgeScoresModified: false,
      routingAlgorithmModified: false,
      exposureFormulaModified: false,
    },
    sampling: {
      attempts: 3,
      acceptedByStratum: { short: 1, medium: 1, long: 1 },
      rejectionCounts: {},
    },
    cases: [
      evaluationCase(1, 'short', 'a', 'b', 'e1'),
      evaluationCase(2, 'medium', 'b', 'c', 'e2'),
      evaluationCase(3, 'long', 'c', 'a', 'e3'),
    ],
  }
}

function clone(value) {
  return structuredClone(value)
}

describe('M7 production artifact validation', () => {
  it('accepts a complete internally consistent Results and Summary pair', () => {
    const results = resultsFixture()
    const summary = createEvaluationSummary(results)
    expect(() => validateEvaluationResults(results, graphFixture(), {
      expectedGraphSha256: 'expected-hash',
      expectedPerStratum: 1,
    })).not.toThrow()
    expect(() => validateEvaluationSummary(results, summary)).not.toThrow()
  })

  it.each([
    ['duplicate directed OD', (value) => {
      value.cases[1].start = clone(value.cases[0].start)
      value.cases[1].destination = clone(value.cases[0].destination)
    }, /重复有向 OD/],
    ['missing Edge', (value) => { value.cases[0].routes.fastest.edgeIds = ['missing'] }, /不存在的 Edge/],
    ['out-of-range indicator', (value) => { value.cases[0].routes.fastest.greenIndicator = 1.1 }, /greenIndicator/],
    ['comparison mismatch', (value) => { value.cases[0].comparisons.balanced.extraDistanceMeters = 1 }, /Comparison 不一致/],
    ['wrong Graph hash', (value) => { value.metadata.graphSha256 = 'wrong' }, /Graph SHA-256/],
    ['coordinate mismatch', (value) => { value.cases[0].start.coordinates = [0, 0] }, /坐标与 Graph Node 不一致/],
    ['discontinuous route', (value) => {
      for (const mode of ['fastest', 'balanced', 'coolest']) value.cases[0].routes[mode].edgeIds = ['e2']
    }, /Edge Sequence 与 OD 不连续/],
    ['wrong distance stratum', (value) => {
      value.cases[0].stratum = 'medium'
      value.cases[1].stratum = 'short'
    }, /Fastest Distance 与 Stratum 不一致/],
  ])('rejects %s', (_label, mutate, expectedError) => {
    const results = clone(resultsFixture())
    mutate(results)
    expect(() => validateEvaluationResults(results, graphFixture(), {
      expectedGraphSha256: 'expected-hash',
      expectedPerStratum: 1,
    })).toThrow(expectedError)
  })

  it('rejects a Summary that cannot be reproduced from Results', () => {
    const results = resultsFixture()
    const summary = createEvaluationSummary(results)
    summary.samples.totalCount = 99
    expect(() => validateEvaluationSummary(results, summary)).toThrow(/Summary 与 Results 不一致/)
  })
})

describe('M7 transactional multi-file publisher', () => {
  it('keeps untouched originals when a backup rename fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'coolroute-m7-backup-'))
    temporaryDirectories.push(directory)
    const paths = ['results.json', 'summary.json', 'report.md'].map((name) => join(directory, name))
    await Promise.all(paths.map((path, index) => writeFile(path, `old-${index}`)))

    let renameCallCount = 0
    const { rename } = await import('node:fs/promises')
    const renameImpl = async (source, destination) => {
      renameCallCount += 1
      if (renameCallCount === 2) throw new Error('injected backup failure')
      await rename(source, destination)
    }

    await expect(publishFilesTransactionally(
      paths.map((path, index) => ({ path, text: `new-${index}` })),
      { renameImpl },
    )).rejects.toThrow(/injected backup failure/)
    await expect(Promise.all(paths.map((path) => readFile(path, 'utf8')))).resolves.toEqual([
      'old-0',
      'old-1',
      'old-2',
    ])
    expect((await readdir(directory)).sort()).toEqual(['report.md', 'results.json', 'summary.json'])
  })

  it('restores every old file if the second replacement fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'coolroute-m7-publish-'))
    temporaryDirectories.push(directory)
    const paths = ['results.json', 'summary.json', 'report.md'].map((name) => join(directory, name))
    await Promise.all(paths.map((path, index) => writeFile(path, `old-${index}`)))

    let renameCallCount = 0
    const { rename } = await import('node:fs/promises')
    const renameImpl = async (source, destination) => {
      renameCallCount += 1
      if (renameCallCount === 5) throw new Error('injected replacement failure')
      await rename(source, destination)
    }

    await expect(publishFilesTransactionally(
      paths.map((path, index) => ({ path, text: `new-${index}` })),
      { renameImpl },
    )).rejects.toThrow(/injected replacement failure/)

    await expect(Promise.all(paths.map((path) => readFile(path, 'utf8')))).resolves.toEqual([
      'old-0',
      'old-1',
      'old-2',
    ])
    expect((await readdir(directory)).sort()).toEqual(['report.md', 'results.json', 'summary.json'])
  })
})
