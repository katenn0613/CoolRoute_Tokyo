import demoAreaConfig from '../../config/tokyo23_area.json'

export const demoArea = Object.freeze({
  ...demoAreaConfig,
  center: Object.freeze([...demoAreaConfig.center]),
  boundingBox: Object.freeze([...demoAreaConfig.boundingBox]),
})
