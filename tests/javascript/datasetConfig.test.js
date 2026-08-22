import { describe, expect, it } from 'vitest'

import { datasets, defaultDataset } from '../../src/config/datasetConfig.js'
import { demoArea } from '../../src/config/demoArea.js'

describe('Production Dataset Config', () => {
  it('keeps Core5 as Production default and registers Tokyo23 Binary/MVT as experimental', () => {
    expect(defaultDataset.id).toBe('tokyo-core5')
    expect(defaultDataset.runtime).toBe('json-main-thread')
    expect(datasets['tokyo-core5']).toMatchObject({
      runtime: 'json-main-thread',
      graphPath: 'data/graph_tokyo_core5.json',
    })
    expect(datasets['tokyo23-route-a']).toMatchObject({
      runtime: 'binary-worker',
      graphPath: 'data/graph_tokyo23.bin.gz',
      fallbackId: 'tokyo-core5',
      stability: 'experimental',
    })
    expect(demoArea.name).toBe('東京都心5区')
  })
})
