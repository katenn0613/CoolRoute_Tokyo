import tokyo23Area from '../../config/tokyo23_area.json'
import core5Area from '../../config/tokyo_core5_area.json'

function freezeArea(area, displayName = area.name) {
  return Object.freeze({
    ...area,
    name: displayName,
    center: Object.freeze([...area.center]),
    boundingBox: Object.freeze([...area.boundingBox]),
  })
}

export const datasets = Object.freeze({
  'tokyo-core5': Object.freeze({
    id: 'tokyo-core5',
    label: '東京都心5区',
    stability: 'fallback',
    runtime: 'json-main-thread',
    graphPath: 'data/graph_tokyo_core5.json',
    shadePath: 'data/shade_tokyo_core5.json',
    drinkingStationsPath: 'data/drinking_stations_tokyo_core5.geojson',
    area: freezeArea(core5Area),
  }),
  'tokyo23-route-a': Object.freeze({
    id: 'tokyo23-route-a',
    label: '東京23区',
    stability: 'production',
    runtime: 'binary-worker',
    graphPath: 'data/graph_tokyo23.bin.gz',
    rawGraphPath: 'data/graph_tokyo23.bin',
    shadeMetadataPath: 'data/shade_metadata_tokyo23.json',
    drinkingStationsPath: 'data/drinking_stations_tokyo23.geojson',
    fallbackId: 'tokyo-core5',
    area: freezeArea(tokyo23Area, '東京23区'),
  }),
})

export const defaultDataset = datasets['tokyo23-route-a']

export function resolveDataset(datasetId) {
  return datasets[datasetId] ?? defaultDataset
}

export function requestedDatasetId(search = globalThis.location?.search ?? '') {
  const requested = new URLSearchParams(search).get('dataset')
  return Object.hasOwn(datasets, requested) ? requested : defaultDataset.id
}
