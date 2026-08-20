import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { routingConfig } from '../src/config/routingConfig.js'
import { calculateRouteBundle } from '../src/routing/calculateRouteBundle.js'
import { prepareGraph } from '../src/routing/graphLoader.js'
import { createEvaluationCase } from './evaluation/evaluator.mjs'
import { publishFilesTransactionally } from './evaluation/publisher.mjs'
import { sampleStratifiedOdPairs } from './evaluation/sampler.mjs'
import { normalizeForOutput, renderJapaneseSummary, serializeJson } from './evaluation/serializer.mjs'
import { createEvaluationSummary } from './evaluation/summary.mjs'
import { validateEvaluationResults, validateEvaluationSummary } from './evaluation/validation.mjs'

const EVALUATION_SCHEMA_VERSION = '1.0.0'
const RANDOM_SEED = 20260821
const TARGET_PER_STRATUM = 30
const MAXIMUM_ATTEMPTS = 100000

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

function createMetadata(payload, graphHash) {
  return {
    evaluationSchemaVersion: EVALUATION_SCHEMA_VERSION,
    graphSchemaVersion: payload.metadata.graphVersion,
    graphSha256: graphHash,
    graphNodeCount: payload.metadata.nodeCount,
    graphEdgeCount: payload.metadata.edgeCount,
    demoArea: {
      id: payload.metadata.demoArea.id,
      name: payload.metadata.demoArea.name,
      boundingBox: payload.metadata.demoArea.boundingBox,
    },
    seed: RANDOM_SEED,
    samplingRules: {
      directedOdPairs: true,
      maximumAttempts: MAXIMUM_ATTEMPTS,
      straightDistanceMeters: { minimum: 350, maximum: 1800 },
      maximumFastestToStraightDistanceRatio: 3,
      strata: {
        short: { minimumMetersInclusive: 400, maximumMetersExclusive: 1000, target: 30 },
        medium: { minimumMetersInclusive: 1000, maximumMetersExclusive: 2000, target: 30 },
        long: { minimumMetersInclusive: 2000, maximumMetersInclusive: 3500, target: 30 },
      },
      tradeoffBasedFiltering: false,
    },
    routingConfig: { ...routingConfig },
    edgeScoresModified: false,
    routingAlgorithmModified: false,
    exposureFormulaModified: false,
  }
}

export function buildEvaluationArtifacts({ graphText, samplingOverrides = {} }) {
  if (typeof graphText !== 'string' || graphText.length === 0) {
    throw new TypeError('Evaluation 需要 graph.json 原始文本。')
  }
  const payload = JSON.parse(graphText)
  const graph = prepareGraph(payload)
  const targetPerStratum = samplingOverrides.targetPerStratum ?? TARGET_PER_STRATUM
  const maximumAttempts = samplingOverrides.maximumAttempts ?? MAXIMUM_ATTEMPTS
  const graphHash = sha256(graphText)
  const sample = sampleStratifiedOdPairs({
    graph,
    calculateBundle: calculateRouteBundle,
    seed: RANDOM_SEED,
    targetPerStratum,
    maximumAttempts,
  })
  const rawResults = {
    metadata: createMetadata(payload, graphHash),
    sampling: sample.audit,
    cases: sample.cases.map((item, index) => createEvaluationCase({
      index: index + 1,
      ...item,
    })),
  }
  rawResults.metadata.samplingRules.maximumAttempts = maximumAttempts
  for (const stratum of Object.values(rawResults.metadata.samplingRules.strata)) {
    stratum.target = targetPerStratum
  }

  const results = normalizeForOutput(rawResults)
  const summary = normalizeForOutput(createEvaluationSummary(results))
  validateEvaluationResults(results, graph, {
    expectedGraphSha256: graphHash,
    expectedPerStratum: targetPerStratum,
  })
  validateEvaluationSummary(results, summary)
  return {
    results,
    summary,
    texts: {
      resultsJson: serializeJson(results),
      summaryJson: serializeJson(summary),
      reportMarkdown: renderJapaneseSummary(summary),
    },
  }
}

export async function runProductionEvaluation({ rootDirectory = process.cwd() } = {}) {
  const graphPath = resolve(rootDirectory, 'public/data/graph.json')
  const graphText = await readFile(graphPath, 'utf8')
  const artifacts = buildEvaluationArtifacts({ graphText })
  const outputPaths = {
    results: resolve(rootDirectory, 'evaluation/evaluation_results.json'),
    summary: resolve(rootDirectory, 'evaluation/evaluation_summary.json'),
    report: resolve(rootDirectory, 'docs/EVALUATION_SUMMARY_JA.md'),
  }
  await publishFilesTransactionally([
    { path: outputPaths.results, text: artifacts.texts.resultsJson },
    { path: outputPaths.summary, text: artifacts.texts.summaryJson },
    { path: outputPaths.report, text: artifacts.texts.reportMarkdown },
  ])
  return { ...artifacts, outputPaths }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  const { results, outputPaths } = await runProductionEvaluation()
  process.stdout.write([
    `M7 Evaluation: ${results.cases.length} OD`,
    `Strata: ${JSON.stringify(results.sampling.acceptedByStratum)}`,
    `Attempts: ${results.sampling.attempts}`,
    `Results: ${outputPaths.results}`,
    `Summary: ${outputPaths.summary}`,
    `Report: ${outputPaths.report}`,
    '',
  ].join('\n'))
}
