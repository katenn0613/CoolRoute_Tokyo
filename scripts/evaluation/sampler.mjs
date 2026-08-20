const EARTH_RADIUS_METERS = 6_371_000
const STRATA = Object.freeze(['short', 'medium', 'long'])

export function createSeededRandom(seed) {
  if (!Number.isInteger(seed)) throw new TypeError('Random Seed 必须是整数。')
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

export function straightDistanceMeters(first, second) {
  for (const [name, point] of [['first', first], ['second', second]]) {
    if (!Number.isFinite(point?.lon) || !Number.isFinite(point?.lat)) {
      throw new TypeError(`${name} 坐标无效。`)
    }
  }
  const latitudeRadians = ((first.lat + second.lat) / 2) * Math.PI / 180
  const x = (second.lon - first.lon) * Math.cos(latitudeRadians)
  const y = second.lat - first.lat
  return Math.hypot(x, y) * Math.PI / 180 * EARTH_RADIUS_METERS
}

export function classifyFastestDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) return null
  if (distanceMeters >= 400 && distanceMeters < 1000) return 'short'
  if (distanceMeters >= 1000 && distanceMeters < 2000) return 'medium'
  if (distanceMeters >= 2000 && distanceMeters <= 3500) return 'long'
  return null
}

function compareNodeIds(first, second) {
  const firstId = String(first.id)
  const secondId = String(second.id)
  if (firstId < secondId) return -1
  if (firstId > secondId) return 1
  return 0
}

function createRejectionCounts() {
  return {
    sameNode: 0,
    duplicateDirectedPair: 0,
    straightDistanceOutOfRange: 0,
    routeCalculationFailed: 0,
    fastestDistanceOutOfRange: 0,
    routeToStraightDistanceRatioExceeded: 0,
    stratumFull: 0,
  }
}

function allStrataFull(counts, targetPerStratum) {
  return STRATA.every((stratum) => counts[stratum] >= targetPerStratum)
}

export function sampleStratifiedOdPairs({
  graph,
  calculateBundle,
  seed = 20260821,
  targetPerStratum = 30,
  maximumAttempts = 100000,
}) {
  if (!(graph?.nodes instanceof Map) || graph.nodes.size < 2) {
    throw new TypeError('OD 抽样需要至少两个 Road Graph Node。')
  }
  if (typeof calculateBundle !== 'function') {
    throw new TypeError('OD 抽样需要 calculateBundle Function。')
  }
  if (!Number.isInteger(targetPerStratum) || targetPerStratum <= 0) {
    throw new RangeError('targetPerStratum 必须是正整数。')
  }
  if (!Number.isInteger(maximumAttempts) || maximumAttempts <= 0) {
    throw new RangeError('maximumAttempts 必须是正整数。')
  }

  const nodes = [...graph.nodes.values()].sort(compareNodeIds)
  const random = createSeededRandom(seed)
  const cases = []
  const acceptedPairs = new Set()
  const acceptedByStratum = { short: 0, medium: 0, long: 0 }
  const rejectionCounts = createRejectionCounts()
  let attempts = 0

  while (attempts < maximumAttempts && !allStrataFull(acceptedByStratum, targetPerStratum)) {
    attempts += 1
    const start = nodes[Math.floor(random() * nodes.length)]
    const destination = nodes[Math.floor(random() * nodes.length)]
    if (start.id === destination.id) {
      rejectionCounts.sameNode += 1
      continue
    }

    const pairKey = `${start.id}\u0000${destination.id}`
    if (acceptedPairs.has(pairKey)) {
      rejectionCounts.duplicateDirectedPair += 1
      continue
    }

    const straightDistance = straightDistanceMeters(start, destination)
    if (straightDistance < 350 || straightDistance > 1800) {
      rejectionCounts.straightDistanceOutOfRange += 1
      continue
    }

    let bundle
    try {
      bundle = calculateBundle(graph, start.id, destination.id)
    } catch {
      rejectionCounts.routeCalculationFailed += 1
      continue
    }
    const fastestDistance = bundle?.routes?.fastest?.metrics?.distanceMeters
    const stratum = classifyFastestDistance(fastestDistance)
    if (stratum === null) {
      rejectionCounts.fastestDistanceOutOfRange += 1
      continue
    }
    if (fastestDistance / straightDistance > 3) {
      rejectionCounts.routeToStraightDistanceRatioExceeded += 1
      continue
    }
    if (acceptedByStratum[stratum] >= targetPerStratum) {
      rejectionCounts.stratumFull += 1
      continue
    }

    acceptedPairs.add(pairKey)
    acceptedByStratum[stratum] += 1
    cases.push({ start, destination, straightDistanceMeters: straightDistance, stratum, bundle })
  }

  if (!allStrataFull(acceptedByStratum, targetPerStratum)) {
    throw new Error(
      `OD 分层抽样不足：${JSON.stringify(acceptedByStratum)}，attempts=${attempts}，target=${targetPerStratum}`,
    )
  }

  return {
    cases,
    audit: {
      attempts,
      acceptedByStratum,
      rejectionCounts,
    },
  }
}
