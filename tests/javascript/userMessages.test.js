import { describe, expect, it } from 'vitest'
import { GraphLoadError } from '../../src/routing/graphLoader.js'
import { NearestNodeError, PointOutsideDemoAreaError } from '../../src/routing/nearestNode.js'
import { RouteBundleError } from '../../src/routing/calculateRouteBundle.js'
import { toUserRoutingMessage } from '../../src/routing/userMessages.js'
import { RouteEngineError } from '../../src/routing/routeEngine.js'

describe('M6 用户错误隔离', () => {
  it('隐藏 Graph 技术错误', () => {
    const error = new GraphLoadError('HTTP 503 from internal resource')
    expect(toUserRoutingMessage(error, 'graph-load')).toBe('道路データの読み込みに失敗しました。')
  })

  it('把范围和吸附错误转换为日语用户消息', () => {
    expect(toUserRoutingMessage(new PointOutsideDemoAreaError('secret bbox')))
      .toBe('対象エリア内の道路付近を選択してください。')
    expect(toUserRoutingMessage(new NearestNodeError('secret distance')))
      .toBe('対象エリア内の道路付近を選択してください。')
  })

  it('把不可达与未知异常转换为稳定消息', () => {
    expect(toUserRoutingMessage(new RouteBundleError('internal route detail')))
      .toBe('ルートを見つけることができませんでした。')
    expect(toUserRoutingMessage(new Error('private exception')))
      .toBe('処理に失敗しました。もう一度お試しください。')
  })

  it('把 Worker 的吸附、不可达与加载错误按 code 隔离', () => {
    expect(toUserRoutingMessage(new RouteEngineError('secret snap', 'snap')))
      .toBe('対象エリア内の道路付近を選択してください。')
    expect(toUserRoutingMessage(new RouteEngineError('component detail', 'route')))
      .toBe('ルートを見つけることができませんでした。')
    expect(toUserRoutingMessage(new RouteEngineError('binary detail', 'graph-load')))
      .toBe('道路データの読み込みに失敗しました。')
  })
})
