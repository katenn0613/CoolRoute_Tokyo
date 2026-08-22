import { GraphLoadError, GraphSchemaError } from './graphLoader.js'
import { NearestNodeError, PointOutsideDemoAreaError } from './nearestNode.js'
import { RouteBundleError } from './calculateRouteBundle.js'
import { RouteCalculationError } from './dijkstra.js'

export function toUserRoutingMessage(error, context = 'interaction') {
  if (
    context === 'graph-load'
    || error instanceof GraphLoadError
    || error instanceof GraphSchemaError
    || error?.code === 'graph-load'
  ) {
    return '道路データの読み込みに失敗しました。'
  }
  if (
    error instanceof PointOutsideDemoAreaError
    || error instanceof NearestNodeError
    || error?.code === 'snap'
  ) {
    return '対象エリア内の道路付近を選択してください。'
  }
  if (
    error instanceof RouteBundleError
    || error instanceof RouteCalculationError
    || error?.code === 'route'
  ) {
    return 'ルートを見つけることができませんでした。'
  }
  if (context === 'invalid-point') return '別の地点を選択してください。'
  return '処理に失敗しました。もう一度お試しください。'
}
