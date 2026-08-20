export function buildShadeFeatureCollection(graph, payload, scenario) {
  const scenarioIndex = payload?.metadata?.scenarios?.indexOf(scenario) ?? -1
  if (scenarioIndex < 0) throw new RangeError(`不支持的 Shade 场景：${scenario}`)
  return {
    type: 'FeatureCollection',
    features: [...graph.edges.values()].map((edge) => ({
      type: 'Feature',
      id: edge.id,
      properties: {
        edgeId: edge.id,
        shadeScore: payload.edgeShadeScores[edge.id][scenarioIndex],
        scenario,
      },
      geometry: {
        type: 'LineString',
        coordinates: edge.geometry,
      },
    })),
  }
}

