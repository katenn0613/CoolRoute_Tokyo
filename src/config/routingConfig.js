export const routingConfig = Object.freeze({
  walkingSpeedMetersPerSecond: 1.4,
  maximumSnapDistanceMeters: 200,
  greenWeight: 0.7,
  waterWeight: 0.3,
  balancedLambda: 1,
  coolestLambda: 3,
  // null 表示关闭；0.25 表示候选路线最多比 Fastest 多走 25%。
  maximumExtraDistanceRatio: null,
})
