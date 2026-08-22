import { describe, expect, it } from 'vitest'

import {
  datasets,
  defaultDataset,
  requestedDatasetId,
} from '../../src/config/datasetConfig.js'
import { demoArea } from '../../src/config/demoArea.js'

describe('Production Dataset Config', () => {
  it('loads the verified Tokyo23 Binary/MVT runtime by default and keeps Core5 as fallback', () => {
    expect(defaultDataset.id).toBe('tokyo23-route-a')
    expect(defaultDataset.label).toBe('東京23区')
    expect(defaultDataset.runtime).toBe('binary-worker')
    expect(requestedDatasetId('')).toBe('tokyo23-route-a')
    expect(requestedDatasetId('?dataset=tokyo-core5')).toBe('tokyo-core5')
    expect(datasets['tokyo-core5']).toMatchObject({
      runtime: 'json-main-thread',
      graphPath: 'data/graph_tokyo_core5.json',
      stability: 'fallback',
    })
    expect(datasets['tokyo23-route-a']).toMatchObject({
      runtime: 'binary-worker',
      graphPath: 'data/graph_tokyo23.bin.gz',
      fallbackId: 'tokyo-core5',
      stability: 'production',
    })
    expect(demoArea.name).toBe('東京都心5区')
  })
})
