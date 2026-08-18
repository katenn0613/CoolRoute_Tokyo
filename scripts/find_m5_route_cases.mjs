import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

import { calculateRouteBundle } from '../src/routing/calculateRouteBundle.js'
import { prepareGraph } from '../src/routing/graphLoader.js'

const SEED = 20260818
const MAX_ATTEMPTS = 240
const outputPath = resolve(process.cwd(), 'public/data/m5_route_cases.json')

function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

function straightDistanceMeters(first, second) {
  const latitudeRadians = ((first.lat + second.lat) / 2) * Math.PI / 180
  const x = (second.lon - first.lon) * Math.cos(latitudeRadians)
  const y = second.lat - first.lat
  return Math.hypot(x, y) * Math.PI / 180 * 6_371_000
}

function sameEdges(first, second) {
  return first.result.edgeSequence.length === second.result.edgeSequence.length
    && first.result.edgeSequence.every((edge, index) => edge.id === second.result.edgeSequence[index].id)
}

function serializeRoute(route) {
  return {
    distanceMeters: route.metrics.distanceMeters,
    walkingTimeSeconds: route.metrics.walkingTimeSeconds,
    averageHeatExposure: route.metrics.averageHeatExposure,
    modelledExposureLoad: route.metrics.modelledExposureLoad,
    greenIndicator: route.metrics.greenIndicator,
    waterAccessIndicator: route.metrics.waterAccessIndicator,
    totalCost: route.result.totalCost,
    edgeIds: route.result.edgeSequence.map((edge) => edge.id),
    calculationTimeMs: route.calculationTimeMs,
  }
}

const payload = JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/graph.json'), 'utf8'))
const graph = prepareGraph(payload)
const nodes = [...graph.nodes.values()]
const random = seededRandom(SEED)
const sameCases = []
const tradeoffCases = []
let validCandidateCount = 0
const searchStartedAt = performance.now()

for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
  const start = nodes[Math.floor(random() * nodes.length)]
  const destination = nodes[Math.floor(random() * nodes.length)]
  if (start.id === destination.id) continue
  const straightDistance = straightDistanceMeters(start, destination)
  if (straightDistance < 350 || straightDistance > 1800) continue
  let bundle
  try {
    bundle = calculateRouteBundle(graph, start.id, destination.id)
  } catch {
    continue
  }
  const fastestDistance = bundle.routes.fastest.metrics.distanceMeters
  if (fastestDistance < 400 || fastestDistance > 3500) continue
  if (fastestDistance / straightDistance > 3) continue
  validCandidateCount += 1
  const fastestEqualsCoolest = sameEdges(bundle.routes.fastest, bundle.routes.coolest)
  const item = {
    id: `m5-case-${String(validCandidateCount).padStart(2, '0')}`,
    startNodeId: start.id,
    destinationNodeId: destination.id,
    start: [start.lon, start.lat],
    destination: [destination.lon, destination.lat],
    straightDistanceMeters: straightDistance,
    fastestEqualsCoolest,
    routes: Object.fromEntries(
      Object.entries(bundle.routes).map(([mode, route]) => [mode, serializeRoute(route)]),
    ),
    comparisons: bundle.comparisons,
    totalCalculationTimeMs: bundle.totalCalculationTimeMs,
  }
  if (fastestEqualsCoolest) sameCases.push(item)
  else tradeoffCases.push(item)
  if (sameCases.length >= 2 && tradeoffCases.length >= 3) break
}

if (sameCases.length < 1 || tradeoffCases.length < 3) {
  throw new Error(
    `真实案例不足：same=${sameCases.length}, tradeoff=${tradeoffCases.length}, attempts=${MAX_ATTEMPTS}`,
  )
}

const selectedCases = [...tradeoffCases.slice(0, 3), ...sameCases.slice(0, 2)]
const output = {
  metadata: {
    dataset: 'M4 production OpenStreetMap + official environment Edge fields',
    graphVersion: payload.metadata.graphVersion,
    seed: SEED,
    maximumAttempts: MAX_ATTEMPTS,
    validCandidateCount,
    searchTimeMs: performance.now() - searchStartedAt,
    selectionRules: {
      straightDistanceMeters: [350, 1800],
      fastestDistanceMeters: [400, 3500],
      maximumRouteToStraightDistanceRatio: 3,
      minimumSameCases: 1,
      minimumTradeoffCases: 3,
    },
    edgeScoresModified: false,
  },
  cases: selectedCases,
}
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`)
console.log(JSON.stringify(output, null, 2))
