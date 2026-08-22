import { assetPath } from '../utils/assetPath.js'

export class RouteEngineError extends Error {
  constructor(message, code = 'route-engine') {
    super(message)
    this.name = 'RouteEngineError'
    this.code = code
  }
}

const defaultWorkerFactory = () => new Worker(
  new URL('./route.worker.js', import.meta.url),
  { type: 'module' },
)

export function createRouteEngine({
  graphUrl = assetPath('data/graph_tokyo23.bin.gz'),
  rawGraphUrl = assetPath('data/graph_tokyo23.bin'),
  shadeMetadataUrl = assetPath('data/shade_metadata_tokyo23.json'),
  boundingBox,
  workerFactory = defaultWorkerFactory,
} = {}) {
  const worker = workerFactory()
  const pending = new Map()
  let nextId = 1
  let disposed = false

  worker.onmessage = (event) => {
    const { id, ok, error, ...payload } = event.data ?? {}
    const request = pending.get(id)
    if (!request) return
    pending.delete(id)
    if (ok) request.resolve(payload)
    else request.reject(new RouteEngineError(
      error?.message ?? '路由引擎未知错误。',
      error?.code ?? 'route-engine',
    ))
  }
  worker.onerror = (event) => {
    const error = new RouteEngineError(event?.message ?? '路由 Worker 崩溃。', 'worker-crash')
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }

  function call(type, payload = {}) {
    if (disposed) return Promise.reject(new RouteEngineError('路由引擎已经关闭。'))
    return new Promise((resolve, reject) => {
      const id = nextId
      nextId += 1
      pending.set(id, { resolve, reject })
      worker.postMessage({ id, type, ...payload })
    })
  }

  return {
    init() {
      return call('init', { graphUrl, rawGraphUrl, shadeMetadataUrl, boundingBox })
    },
    snap(point, maximumDistanceMeters) {
      return call('snap', { point, maxMeters: maximumDistanceMeters })
    },
    calculateBundle(startIndex, destinationIndex, scenario) {
      return call('route', { startIndex, destinationIndex, scenario })
    },
    dispose() {
      disposed = true
      const error = new RouteEngineError('路由引擎已经关闭。')
      for (const request of pending.values()) request.reject(error)
      pending.clear()
      worker.terminate()
    },
  }
}
