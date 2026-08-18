const EARTH_RADIUS_METERS = 6_371_008.8

export class PointOutsideDemoAreaError extends Error {
  constructor(message = '所选位置超出当前 Demo Area。') {
    super(message)
    this.name = 'PointOutsideDemoAreaError'
  }
}

export class NearestNodeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'NearestNodeError'
  }
}

function isCoordinate(point) {
  return Array.isArray(point)
    && point.length === 2
    && Number.isFinite(point[0])
    && Number.isFinite(point[1])
}

export function isPointInDemoArea(point, boundingBox) {
  if (!isCoordinate(point) || !Array.isArray(boundingBox) || boundingBox.length !== 4) {
    return false
  }
  const [lon, lat] = point
  const [west, south, east, north] = boundingBox
  return lon >= west && lon <= east && lat >= south && lat <= north
}

export function distanceMeters(first, second) {
  const toRadians = (degrees) => degrees * Math.PI / 180
  const lat1 = toRadians(first[1])
  const lat2 = toRadians(second[1])
  const deltaLat = lat2 - lat1
  const deltaLon = toRadians(second[0] - first[0])
  const sinLat = Math.sin(deltaLat / 2)
  const sinLon = Math.sin(deltaLon / 2)
  const a = sinLat ** 2 + Math.cos(lat1) * Math.cos(lat2) * sinLon ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function findNearestNode(
  graph,
  point,
  { boundingBox, maximumDistanceMeters },
) {
  if (!isPointInDemoArea(point, boundingBox)) {
    throw new PointOutsideDemoAreaError()
  }
  if (!(graph?.nodes instanceof Map) || graph.nodes.size === 0) {
    throw new NearestNodeError('Road Graph 没有可用于吸附的 Node。')
  }

  let nearestNode = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const node of graph.nodes.values()) {
    const candidateDistance = distanceMeters(point, [node.lon, node.lat])
    if (candidateDistance < nearestDistance) {
      nearestNode = node
      nearestDistance = candidateDistance
    }
  }

  if (!nearestNode || nearestDistance > maximumDistanceMeters) {
    throw new NearestNodeError(
      `附近 ${maximumDistanceMeters} m 内没有可用的步行道路节点。`,
    )
  }

  return {
    node: nearestNode,
    distanceMeters: nearestDistance,
  }
}
