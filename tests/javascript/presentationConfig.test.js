import { describe, expect, it } from 'vitest'
import {
  getRouteSampleStyle,
  routePresentation,
} from '../../src/config/presentationConfig.js'

describe('M6 路线呈现单一配置源', () => {
  it('为三种路线提供一致但可区分的 UI 线型与线宽', () => {
    const fastest = getRouteSampleStyle(routePresentation.fastest, 'card')
    const balanced = getRouteSampleStyle(routePresentation.balanced, 'card')
    const coolest = getRouteSampleStyle(routePresentation.coolest, 'card')

    expect(fastest.backgroundImage).toBeUndefined()
    expect(balanced.backgroundImage).not.toBe(coolest.backgroundImage)
    expect(fastest.height).not.toBe(coolest.height)
    expect(getRouteSampleStyle(routePresentation.coolest, 'legend').width).toBe('24px')
  })

  it('将 Selected Route opacity 收口在呈现配置中', () => {
    for (const presentation of Object.values(routePresentation)) {
      expect(presentation.selectedOpacity).toBeGreaterThan(0)
      expect(presentation.selectedOpacity).toBeLessThanOrEqual(1)
    }
  })
})
