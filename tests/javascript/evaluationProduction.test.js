import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildEvaluationArtifacts } from '../../scripts/evaluate_routes.mjs'
import { prepareGraph } from '../../src/routing/graphLoader.js'
import {
  validateEvaluationResults,
  validateEvaluationSummary,
} from '../../scripts/evaluation/validation.mjs'

function productionShapedGraphPayload() {
  const nodes = {}
  for (let index = 0; index < 25; index += 1) {
    const id = `n${String(index).padStart(2, '0')}`
    nodes[id] = { id, lon: 139.74 + index * 0.001, lat: 35.68 }
  }
  const edges = []
  for (let index = 0; index < 24; index += 1) {
    const source = `n${String(index).padStart(2, '0')}`
    const target = `n${String(index + 1).padStart(2, '0')}`
    const sourceCoordinates = [nodes[source].lon, nodes[source].lat]
    const targetCoordinates = [nodes[target].lon, nodes[target].lat]
    edges.push({
      id: `${source}-${target}-0`,
      source,
      target,
      length: 150,
      geometry: [sourceCoordinates, targetCoordinates],
      green_score: index % 2 === 0 ? 0.2 : 0.4,
      water_penalty: index % 3 === 0 ? 0.6 : 0.3,
    })
    edges.push({
      id: `${target}-${source}-0`,
      source: target,
      target: source,
      length: 150,
      geometry: [targetCoordinates, sourceCoordinates],
      green_score: index % 2 === 0 ? 0.2 : 0.4,
      water_penalty: index % 3 === 0 ? 0.6 : 0.3,
    })
  }
  return {
    metadata: {
      dataset: 'OpenStreetMap',
      provider: 'OpenStreetMap contributors',
      graphVersion: '1.1.0',
      nodeCount: Object.keys(nodes).length,
      edgeCount: edges.length,
      demoArea: {
        id: 'synthetic-integration-only',
        name: 'Synthetic Integration Fixture',
        boundingBox: [139.74, 35.67, 139.77, 35.69],
      },
    },
    nodes,
    edges,
  }
}

describe('M7 evaluation production orchestration', () => {
  it('builds deterministic in-memory artifacts from a real-shaped Graph', () => {
    const graphText = `${JSON.stringify(productionShapedGraphPayload())}\n`
    const first = buildEvaluationArtifacts({
      graphText,
      samplingOverrides: { targetPerStratum: 1, maximumAttempts: 10000 },
    })
    const second = buildEvaluationArtifacts({
      graphText,
      samplingOverrides: { targetPerStratum: 1, maximumAttempts: 10000 },
    })

    expect(second.texts).toEqual(first.texts)
    expect(first.results.metadata).toMatchObject({
      evaluationSchemaVersion: '1.0.0',
      graphSchemaVersion: '1.1.0',
      graphSha256: createHash('sha256').update(graphText).digest('hex'),
      graphNodeCount: 25,
      graphEdgeCount: 48,
      seed: 20260821,
      edgeScoresModified: false,
      routingAlgorithmModified: false,
      exposureFormulaModified: false,
    })
    expect(first.results.sampling.acceptedByStratum).toEqual({ short: 1, medium: 1, long: 1 })
    expect(first.results.cases).toHaveLength(3)
    expect(first.texts.resultsJson).toBe(`${JSON.stringify(first.results, null, 2)}\n`)
    expect(first.texts.summaryJson).toBe(`${JSON.stringify(first.summary, null, 2)}\n`)
    expect(first.texts.reportMarkdown).toContain('平均暑さ曝露スコア')
    expect(first.texts.resultsJson).not.toMatch(/generatedAt|calculationTimeMs|\/Users\//)
  })

  it('validates the checked-in 90-OD artifacts against the current Production Graph', () => {
    const graphText = readFileSync(resolve('public/data/graph.json'), 'utf8')
    const resultsText = readFileSync(resolve('evaluation/evaluation_results.json'), 'utf8')
    const summaryText = readFileSync(resolve('evaluation/evaluation_summary.json'), 'utf8')
    const graph = prepareGraph(JSON.parse(graphText))
    const results = JSON.parse(resultsText)
    const summary = JSON.parse(summaryText)

    expect(() => validateEvaluationResults(results, graph, {
      expectedGraphSha256: createHash('sha256').update(graphText).digest('hex'),
      expectedPerStratum: 30,
    })).not.toThrow()
    expect(() => validateEvaluationSummary(results, summary)).not.toThrow()
    expect(results.cases).toHaveLength(90)
    expect(results.sampling.acceptedByStratum).toEqual({ short: 30, medium: 30, long: 30 })
    expect(resultsText).not.toMatch(/calculationTimeMs|totalCalculationTimeMs|searchTimeMs|\/Users\//i)
  })
})
