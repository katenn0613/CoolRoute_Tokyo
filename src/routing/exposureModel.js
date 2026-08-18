import { routingConfig } from '../config/routingConfig.js'

export const ROUTING_MODES = Object.freeze({
  FASTEST: 'fastest',
  BALANCED: 'balanced',
  COOLEST: 'coolest',
})

function mergedConfig(overrides = {}) {
  return { ...routingConfig, ...overrides }
}

function boundedEdgeField(edge, field) {
  const value = edge?.[field]
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`Edge ${edge?.id ?? 'unknown'} 的 ${field} 必须是 [0,1] 内有限数。`)
  }
  return value
}

function edgeLength(edge) {
  if (!Number.isFinite(edge?.length) || edge.length < 0) {
    throw new RangeError(`Edge ${edge?.id ?? 'unknown'} 的 length 必须是非负有限数。`)
  }
  return edge.length
}

export function calculateEdgeHeatExposure(edge, overrides = {}) {
  const config = mergedConfig(overrides)
  if (
    !Number.isFinite(config.greenWeight)
    || !Number.isFinite(config.waterWeight)
    || config.greenWeight < 0
    || config.waterWeight < 0
    || Math.abs(config.greenWeight + config.waterWeight - 1) > 1e-12
  ) {
    throw new RangeError('Exposure weights 必须是非负有限数且总和为 1。')
  }
  const greenScore = boundedEdgeField(edge, 'green_score')
  const waterPenalty = boundedEdgeField(edge, 'water_penalty')
  const exposure = config.greenWeight * (1 - greenScore) + config.waterWeight * waterPenalty
  if (!Number.isFinite(exposure) || exposure < -1e-12 || exposure > 1 + 1e-12) {
    throw new RangeError(`Edge ${edge?.id ?? 'unknown'} 的 Heat Exposure Score 无效。`)
  }
  return Math.min(1, Math.max(0, exposure))
}

export function createEdgeWeightFunction(mode, overrides = {}) {
  const config = mergedConfig(overrides)
  const lambdas = {
    [ROUTING_MODES.FASTEST]: 0,
    [ROUTING_MODES.BALANCED]: config.balancedLambda,
    [ROUTING_MODES.COOLEST]: config.coolestLambda,
  }
  if (!Object.hasOwn(lambdas, mode)) throw new RangeError(`未知 Routing Mode：${mode}`)
  const lambda = lambdas[mode]
  if (!Number.isFinite(lambda) || lambda < 0) throw new RangeError(`${mode} lambda 必须是非负有限数。`)
  return (edge) => {
    const length = edgeLength(edge)
    if (lambda === 0) return length
    // Route sum 等价于 distance + lambda × cumulative Modelled Exposure Load。
    return length * (1 + lambda * calculateEdgeHeatExposure(edge, config))
  }
}
