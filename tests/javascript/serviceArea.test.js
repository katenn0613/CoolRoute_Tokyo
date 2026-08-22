import { describe, expect, it, vi } from 'vitest'
import { isPointInServiceArea, loadServiceArea } from '../../src/routing/serviceArea.js'

const serviceArea = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { wardIds: ['13101', '13102', '13103', '13104', '13105'] },
    geometry: {
      type: 'Polygon',
      coordinates: [[[139.7, 35.6], [139.8, 35.6], [139.8, 35.7], [139.7, 35.7], [139.7, 35.6]]],
    },
  }],
}

describe('Core5 Service Area', () => {
  it('accepts a point inside and rejects a point outside the polygon', () => {
    expect(isPointInServiceArea([139.75, 35.65], serviceArea)).toBe(true)
    expect(isPointInServiceArea([139.85, 35.65], serviceArea)).toBe(false)
  })

  it('loads a GitHub Pages compatible static asset', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => serviceArea })
    await expect(loadServiceArea({ fetchImpl })).resolves.toEqual(serviceArea)
    expect(fetchImpl.mock.calls[0][0]).toMatch(/data\/service_area_tokyo_core5\.geojson$/)
  })
})
