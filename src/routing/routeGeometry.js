const COORDINATE_TOLERANCE = 1e-9

export class RouteGeometryError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RouteGeometryError'
  }
}

function coordinatesMatch(first, second) {
  return Math.abs(first[0] - second[0]) <= COORDINATE_TOLERANCE
    && Math.abs(first[1] - second[1]) <= COORDINATE_TOLERANCE
}

export function buildRouteGeoJSON(edgeSequence) {
  if (!Array.isArray(edgeSequence)) {
    throw new RouteGeometryError('Edge Sequence 必须是数组。')
  }
  if (edgeSequence.length === 0) return null

  const coordinates = []
  edgeSequence.forEach((edge, index) => {
    if (!Array.isArray(edge.geometry) || edge.geometry.length < 2) {
      throw new RouteGeometryError(`Edge ${edge.id} 缺少有效 geometry。`)
    }
    if (index > 0) {
      const previous = edgeSequence[index - 1]
      if (previous.target !== edge.source) {
        throw new RouteGeometryError(`Edge ${previous.id} 与 ${edge.id} 的拓扑不连续。`)
      }
      if (!coordinatesMatch(coordinates.at(-1), edge.geometry[0])) {
        throw new RouteGeometryError(`Edge ${previous.id} 与 ${edge.id} 的 geometry 不连续。`)
      }
    }
    const points = index === 0 ? edge.geometry : edge.geometry.slice(1)
    coordinates.push(...points.map((point) => [...point]))
  })

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates,
    },
  }
}
