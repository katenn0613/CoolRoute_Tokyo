import { routingConfig } from '../config/routingConfig.js'

function fixedShadeWeight(shadeWeight) {
  if (shadeWeight !== routingConfig.shadeContributionWeight) {
    throw new RangeError(`shadeWeight 必须固定为 ${routingConfig.shadeContributionWeight}。`)
  }
  return shadeWeight
}

function readonlyScoreView(entries) {
  const scores = new Map(entries)
  return Object.freeze({
    get: (edgeId) => scores.get(edgeId),
    has: (edgeId) => scores.has(edgeId),
    size: scores.size,
  })
}

export function createShadeContext(
  payload,
  scenario,
  shadeWeight = routingConfig.shadeContributionWeight,
) {
  const scenarios = payload?.metadata?.scenarios
  const scenarioIndex = Array.isArray(scenarios) ? scenarios.indexOf(scenario) : -1
  if (scenarioIndex < 0) throw new RangeError(`不支持的 Shade 场景：${scenario}`)
  fixedShadeWeight(shadeWeight)
  const edgeShadeScores = payload?.edgeShadeScores
  if (!edgeShadeScores || typeof edgeShadeScores !== 'object' || Array.isArray(edgeShadeScores)) {
    throw new TypeError('Shade Context 需要 edgeShadeScores。')
  }
  const entries = Object.entries(edgeShadeScores).map(([edgeId, values]) => {
    const score = values?.[scenarioIndex]
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      throw new RangeError(`Edge ${edgeId} 的 Shade Score 无效。`)
    }
    return [edgeId, score]
  })
  return Object.freeze({
    scenario,
    shadeWeight,
    scoreByEdgeId: readonlyScoreView(entries),
    sourceMetadata: Object.freeze({
      shadeSchemaVersion: payload.metadata.schemaVersion,
      roadGraphSchemaVersion: payload.metadata.roadGraphSchemaVersion,
      roadGraphGeneratedAt: payload.metadata.roadGraphGeneratedAt,
    }),
  })
}

export function getEdgeShadeScore(context, edgeId) {
  const score = context?.scoreByEdgeId?.get(edgeId)
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new RangeError(`Edge ${edgeId} 缺少有效 Shade Score。`)
  }
  return score
}
