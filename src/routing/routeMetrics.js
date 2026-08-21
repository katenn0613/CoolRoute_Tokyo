import { routingConfig } from '../config/routingConfig.js'
import {
  calculateEdgeHeatExposure,
  calculateShadeAwareHeatExposure,
} from './exposureModel.js'
import { getEdgeShadeScore } from './shadeContext.js'

export function calculateRouteMetrics(edgeSequence, speedOrConfig = routingConfig, shadeContext = null) {
  if (!Array.isArray(edgeSequence)) {
    throw new TypeError('Edge Sequence 必须是数组。')
  }
  const config = typeof speedOrConfig === 'number'
    ? { ...routingConfig, walkingSpeedMetersPerSecond: speedOrConfig }
    : { ...routingConfig, ...speedOrConfig }
  if (!Number.isFinite(config.walkingSpeedMetersPerSecond) || config.walkingSpeedMetersPerSecond <= 0) {
    throw new RangeError('步行速度必须是正数。')
  }
  let distanceMeters = 0
  let modelledExposureLoad = 0
  let weightedGreen = 0
  let weightedWaterPenalty = 0
  let weightedShade = 0
  let shadeAwareExposureLoad = 0
  let modelledUnshadedDistance = 0
  for (const edge of edgeSequence) {
    if (!Number.isFinite(edge?.length) || edge.length < 0) {
      throw new RangeError(`Edge ${edge?.id ?? 'unknown'} length 无效。`)
    }
    const exposure = calculateEdgeHeatExposure(edge, config)
    distanceMeters += edge.length
    modelledExposureLoad += edge.length * exposure
    weightedGreen += edge.length * edge.green_score
    weightedWaterPenalty += edge.length * edge.water_penalty
    if (shadeContext) {
      const shadeScore = getEdgeShadeScore(shadeContext, edge.id)
      weightedShade += edge.length * shadeScore
      modelledUnshadedDistance += edge.length * (1 - shadeScore)
      shadeAwareExposureLoad += edge.length
        * calculateShadeAwareHeatExposure(edge, shadeContext, config)
    }
  }
  const hasDistance = distanceMeters > 0
  return {
    distanceMeters,
    walkingTimeSeconds: distanceMeters / config.walkingSpeedMetersPerSecond,
    edgeCount: edgeSequence.length,
    averageHeatExposure: hasDistance ? modelledExposureLoad / distanceMeters : 0,
    modelledExposureLoad,
    greenIndicator: hasDistance ? weightedGreen / distanceMeters : 0,
    waterAccessIndicator: hasDistance ? 1 - weightedWaterPenalty / distanceMeters : 0,
    averageBuildingShadeScore: shadeContext
      ? (hasDistance ? weightedShade / distanceMeters : 0)
      : null,
    shadeAwareAverageHeatExposure: shadeContext
      ? (hasDistance ? shadeAwareExposureLoad / distanceMeters : 0)
      : null,
    shadeAwareExposureLoad: shadeContext ? shadeAwareExposureLoad : null,
    modelledUnshadedDistance: shadeContext ? modelledUnshadedDistance : null,
    shadeScenario: shadeContext?.scenario ?? null,
  }
}
