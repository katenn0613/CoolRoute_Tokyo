export function createSyntheticRoadGraph() {
  const nodes = new Map([
    ['a', { id: 'a', lon: 139.75, lat: 35.68 }],
    ['b', { id: 'b', lon: 139.751, lat: 35.681 }],
    ['c', { id: 'c', lon: 139.75, lat: 35.682 }],
    ['d', { id: 'd', lon: 139.753, lat: 35.682 }],
    ['x', { id: 'x', lon: 139.76, lat: 35.69 }],
  ])
  const edgeList = [
    {
      id: 'a:b:slow', source: 'a', target: 'b', length: 10,
      green_score: 0, water_penalty: 1,
      geometry: [[139.75, 35.68], [139.751, 35.681]],
    },
    {
      id: 'a:b:fast', source: 'a', target: 'b', length: 2,
      green_score: 0, water_penalty: 1,
      geometry: [[139.75, 35.68], [139.7505, 35.6805], [139.751, 35.681]],
    },
    {
      id: 'b:d:0', source: 'b', target: 'd', length: 5,
      green_score: 0, water_penalty: 1,
      geometry: [[139.751, 35.681], [139.752, 35.6815], [139.753, 35.682]],
    },
    {
      id: 'a:c:0', source: 'a', target: 'c', length: 4,
      green_score: 1, water_penalty: 0,
      geometry: [[139.75, 35.68], [139.75, 35.682]],
    },
    {
      id: 'c:d:0', source: 'c', target: 'd', length: 10,
      green_score: 1, water_penalty: 0,
      geometry: [[139.75, 35.682], [139.753, 35.682]],
    },
  ]
  const edges = new Map(edgeList.map((edge) => [edge.id, edge]))
  const adjacency = new Map([...nodes.keys()].map((nodeId) => [nodeId, []]))
  edgeList.forEach((edge) => adjacency.get(edge.source).push(edge))
  return {
    metadata: { graphVersion: 'synthetic-test-only' },
    nodes,
    edges,
    adjacency,
  }
}
