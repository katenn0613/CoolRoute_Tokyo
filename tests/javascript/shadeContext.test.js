import { describe, expect, it } from 'vitest'
import { routingConfig } from '../../src/config/routingConfig.js'
import { createShadeContext, getEdgeShadeScore } from '../../src/routing/shadeContext.js'

const payload = {
  metadata: {
    schemaVersion: '1.0.0',
    roadGraphSchemaVersion: '1.1.0',
    roadGraphGeneratedAt: 'graph-time',
    scenarios: ['09:00', '12:00', '15:00'],
  },
  edgeShadeScores: {
    'a:b:0': [0.2, 0.5, 0.9],
  },
}

describe('M10.5 Shade Context', () => {
  it('固定 Shade 环境贡献比例为 0.25', () => {
    expect(routingConfig.shadeContributionWeight).toBe(0.25)
  })

  it('按场景建立不可变的 Edge Shade Score 视图', () => {
    const context = createShadeContext(payload, '12:00')

    expect(context).toMatchObject({ scenario: '12:00', shadeWeight: 0.25 })
    expect(getEdgeShadeScore(context, 'a:b:0')).toBe(0.5)
    expect(context.scoreByEdgeId.set).toBeUndefined()
    expect(Object.isFrozen(context)).toBe(true)
    expect(Object.isFrozen(context.sourceMetadata)).toBe(true)
  })

  it('拒绝未知场景、非法权重和缺失 Edge', () => {
    expect(() => createShadeContext(payload, '18:00')).toThrow(/18:00/)
    expect(() => createShadeContext(payload, '12:00', 0.5)).toThrow(/0.25/)
    const context = createShadeContext(payload, '12:00')
    expect(() => getEdgeShadeScore(context, 'missing')).toThrow(/missing/)
  })
})
