import { assetPath } from '../utils/assetPath.js'

export class RouteEngineError extends Error {
  constructor(message, code = 'route-engine') {
    super(message)
    this.name = 'RouteEngineError'
    this.code = code
  }
}

export function createRouteEngine({
  graphUrl = assetPath('data/graph_tokyo23.bin.gz'),
  rawGraphUrl = assetPath('data/graph_tokyo23.bin'),
  shadeMetadataUrl = assetPath('data/shade_metadata_tokyo23.json'),
  boundingBox,
} = {}) {
  const worker = new Worker(new URL('./route.worker.js', import.meta.url), { type: 'module' })
  let nextId = 1
  const pending = new Map()

  worker.onmessage = (event) => {
    const { id, ok, ...payload } = event.data ?? {}
    const request = pending.get(id)
    if (!request) return
    pending.delete(id)
    if (ok) request.resolve(payload)
    else request.reject(new RouteEngineError(payload.error?.message ?? '路由引擎未知错误。'))
  }
  worker.onerror = (event) => {
    const message = event?.message ?? '路由 Worker 崩溃。'
    for (const request of pending.values()) request.reject(new RouteEngineError(message))
    pending.clear()
  }

  function call(type, args) {
    return new Promise((resolve, reject) => {
      const id = nextId
      nextId += 1
      pending.set(id, { resolve, reject })
      worker.postMessage({ id, type, ...args })
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
      worker.terminate()
      pending.clear()
    },
  }
}
