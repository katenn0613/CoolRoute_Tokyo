import { describe, expect, it } from 'vitest'
import {
  formatDistance,
  formatExtraWalkingTime,
  formatPercent,
  formatScore,
  formatWalkingTime,
} from '../../src/utils/formatters.js'

describe('M6 日语单位 Formatter', () => {
  it('按距离长度统一显示 m 或 km', () => {
    expect(formatDistance(850)).toBe('850 m')
    expect(formatDistance(1300)).toBe('1.3 km')
  })

  it('步行时间向上取整为日语分钟', () => {
    expect(formatWalkingTime(1021)).toBe('18分')
  })

  it('额外时间不足一分钟时保留秒数', () => {
    expect(formatExtraWalkingTime(32)).toBe('+32秒')
    expect(formatExtraWalkingTime(90)).toBe('+2分')
  })

  it('统一格式化 Score 和百分比，并保护不可比较值', () => {
    expect(formatScore(0.876)).toBe('0.88')
    expect(formatPercent(8.04)).toBe('8%')
    expect(formatPercent(-5.14, { signed: true })).toBe('−5%')
    expect(formatPercent(null)).toBe('比較不可')
    expect(formatPercent(Number.NaN)).toBe('比較不可')
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('比較不可')
  })
})
