function finiteMetric(metrics, field) {
  const value = metrics?.[field]
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${field} 必须是非负有限数。`)
  return value
}

function reductionPercent(reduction, baseline) {
  return baseline === 0 ? null : (reduction / baseline) * 100
}

export function compareRouteToFastest(candidate, fastest) {
  const candidateDistance = finiteMetric(candidate, 'distanceMeters')
  const fastestDistance = finiteMetric(fastest, 'distanceMeters')
  const candidateTime = finiteMetric(candidate, 'walkingTimeSeconds')
  const fastestTime = finiteMetric(fastest, 'walkingTimeSeconds')
  const candidateAverage = finiteMetric(candidate, 'averageHeatExposure')
  const fastestAverage = finiteMetric(fastest, 'averageHeatExposure')
  const candidateLoad = finiteMetric(candidate, 'modelledExposureLoad')
  const fastestLoad = finiteMetric(fastest, 'modelledExposureLoad')
  const averageReduction = fastestAverage - candidateAverage
  const loadReduction = fastestLoad - candidateLoad
  return {
    extraDistanceMeters: candidateDistance - fastestDistance,
    extraDistancePercent: fastestDistance === 0
      ? null
      : ((candidateDistance - fastestDistance) / fastestDistance) * 100,
    extraWalkingMinutes: (candidateTime - fastestTime) / 60,
    averageHeatExposureChange: candidateAverage - fastestAverage,
    averageHeatExposureReduction: averageReduction,
    averageHeatExposureReductionPercent: reductionPercent(averageReduction, fastestAverage),
    modelledExposureLoadChange: candidateLoad - fastestLoad,
    modelledExposureLoadReduction: loadReduction,
    modelledExposureLoadReductionPercent: reductionPercent(loadReduction, fastestLoad),
  }
}

export function compareShadeAwareRouteToFastest(candidate, fastest) {
  const candidateAverage = finiteMetric(candidate, 'shadeAwareAverageHeatExposure')
  const fastestAverage = finiteMetric(fastest, 'shadeAwareAverageHeatExposure')
  const candidateLoad = finiteMetric(candidate, 'shadeAwareExposureLoad')
  const fastestLoad = finiteMetric(fastest, 'shadeAwareExposureLoad')
  const averageReduction = fastestAverage - candidateAverage
  const loadReduction = fastestLoad - candidateLoad
  return {
    shadeAwareExposureChange: candidateAverage - fastestAverage,
    shadeAwareExposureReductionPercent: reductionPercent(averageReduction, fastestAverage),
    shadeAwareLoadChange: candidateLoad - fastestLoad,
    shadeAwareLoadReductionPercent: reductionPercent(loadReduction, fastestLoad),
  }
}

export function passesDetourGuard(candidateDistance, fastestDistance, maximumExtraDistanceRatio) {
  if (maximumExtraDistanceRatio === null) return true
  if (
    !Number.isFinite(candidateDistance)
    || !Number.isFinite(fastestDistance)
    || !Number.isFinite(maximumExtraDistanceRatio)
    || candidateDistance < 0
    || fastestDistance < 0
    || maximumExtraDistanceRatio < 0
  ) throw new RangeError('Detour Guard 参数必须是非负有限数或 null。')
  return candidateDistance <= fastestDistance * (1 + maximumExtraDistanceRatio)
}
