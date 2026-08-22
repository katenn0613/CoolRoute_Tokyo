import { assetPath } from '../utils/assetPath.js'

function pointInRing([x, y], ring) {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [x1, y1] = ring[index]
    const [x2, y2] = ring[previous]
    const intersects = ((y1 > y) !== (y2 > y))
      && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1
    if (intersects) inside = !inside
  }
  return inside
}

function pointInPolygon(point, coordinates) {
  if (!coordinates?.length || !pointInRing(point, coordinates[0])) return false
  return !coordinates.slice(1).some((hole) => pointInRing(point, hole))
}

export function isPointInServiceArea(point, payload) {
  if (!Array.isArray(point) || point.length !== 2) return false
  const geometry = payload?.features?.[0]?.geometry
  if (geometry?.type === 'Polygon') return pointInPolygon(point, geometry.coordinates)
  if (geometry?.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => pointInPolygon(point, polygon))
  }
  return false
}

export async function loadServiceArea({
  fetchImpl = globalThis.fetch,
  url = assetPath('data/service_area_tokyo_core5.geojson'),
} = {}) {
  const response = await fetchImpl(url)
  if (!response?.ok) throw new Error(`Service Area 加载失败（HTTP ${response?.status ?? 'unknown'}）。`)
  const payload = await response.json()
  const wardIds = payload?.features?.[0]?.properties?.wardIds
  if (
    payload?.type !== 'FeatureCollection'
    || !Array.isArray(wardIds)
    || wardIds.join(',') !== '13101,13102,13103,13104,13105'
    || !['Polygon', 'MultiPolygon'].includes(payload?.features?.[0]?.geometry?.type)
  ) {
    throw new Error('Service Area GeoJSON 契约无效。')
  }
  return payload
}
