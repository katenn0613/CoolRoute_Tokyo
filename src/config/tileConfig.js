import { assetPath } from '../utils/assetPath.js'

const MIN_ZOOM = 10
const MAX_ZOOM = 13

export const tileConfig = Object.freeze({
  sourceLayer: 'default',
  heatSource: Object.freeze({
    type: 'vector',
    tiles: [assetPath('data/tiles/heat/{z}/{x}/{y}.pbf')],
    minzoom: MIN_ZOOM,
    maxzoom: MAX_ZOOM,
  }),
  shadeSource: Object.freeze({
    type: 'vector',
    tiles: [assetPath('data/tiles/shade/{z}/{x}/{y}.pbf')],
    minzoom: MIN_ZOOM,
    maxzoom: MAX_ZOOM,
  }),
})

export function shadePropertyForScenario(scenario) {
  return `shade${scenario.replace(':', '')}`
}
