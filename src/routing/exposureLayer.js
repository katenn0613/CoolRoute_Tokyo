import { calculateEdgeHeatExposure } from './exposureModel.js'

export function buildExposureFeatureCollection(graph, config) {
  if (!(graph?.edges instanceof Map)) {
    throw new TypeError('Exposure Layer には Map 形式の Road Graph edges が必要です。')
  }
  return {
    type: 'FeatureCollection',
    features: [...graph.edges.values()].map((edge) => ({
      type: 'Feature',
      id: edge.id,
      properties: {
        edgeId: edge.id,
        heatExposure: calculateEdgeHeatExposure(edge, config),
      },
      geometry: {
        type: 'LineString',
        coordinates: edge.geometry,
      },
    })),
  }
}
