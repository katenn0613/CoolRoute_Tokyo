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

function absoluteAssetPath(relativePath) {
  const baseUrl = globalThis.location?.href ?? 'http://localhost/'
  return new URL(assetPath(relativePath), baseUrl).href
}

export function createRouteEngine({
  graphUrl = absoluteAssetPath('data/graph_tokyo23.bin.gz'),
  rawGraphUrl = absoluteAssetPath('data/graph_tokyo23.bin'),
  shadeMetadataUrl = absoluteAssetPath('data/shade_metadata_tokyo23.json'),
  boundingBox,
  workerFactory = defaultWorkerFactory,
  snapTimeoutMs = 5_000,
  initTimeoutMs = 120_000,
  routeTimeoutMs = 30_000,
} = {}) {
  const pending = new Map()
  let nextId = 1
  let disposed = false
  let worker = null
  let workerReady = false
  let initPayload = null

  function rejectWorker(instance, error) {
    if (worker === instance) {
      worker = null
      workerReady = false
    }
    instance.terminate()
    for (const [id, request] of pending) {
      if (request.worker !== instance) continue
      clearTimeout(request.timer)
      pending.delete(id)
      request.reject(error)
    }
  }

  function spawnWorker() {
    const instance = workerFactory()
    worker = instance
    instance.onmessage = (event) => {
      const { id, ok, error, ...payload } = event.data ?? {}
      const request = pending.get(id)
      if (!request || request.worker !== instance) return
      clearTimeout(request.timer)
      pending.delete(id)
      if (ok) request.resolve(payload)
      else request.reject(new RouteEngineError(
        error?.message ?? '路由引擎未知错误。',
        error?.code ?? 'route-engine',
      ))
    }
    instance.onerror = (event) => {
      rejectWorker(
        instance,
        new RouteEngineError(event?.message ?? '路由 Worker 崩溃。', 'worker-crash'),
      )
    }
    return instance
  }

  function call(type, payload = {}, timeoutMs) {
    if (disposed) return Promise.reject(new RouteEngineError('路由引擎已经关闭。'))
    const instance = worker ?? spawnWorker()
    return new Promise((resolve, reject) => {
      const id = nextId
      nextId += 1
      const timer = setTimeout(() => {
        if (!pending.has(id)) return
        rejectWorker(
          instance,
          new RouteEngineError('路由 Worker 响应超时。', 'worker-timeout'),
        )
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer, worker: instance })
      instance.postMessage({ id, type, ...payload })
    })
  }

  async function initializeWorker() {
    if (!initPayload) throw new RouteEngineError('路由引擎缺少初始化信息。')
    const info = await call('init', initPayload, initTimeoutMs)
    workerReady = true
    return info
  }

  function isRecoverableWorkerError(error) {
    return error?.code === 'worker-timeout' || error?.code === 'worker-crash'
  }

  return {
    init() {
      initPayload = { graphUrl, rawGraphUrl, shadeMetadataUrl, boundingBox }
      return initializeWorker()
    },
    async snap(point, maximumDistanceMeters) {
      const payload = { point, maxMeters: maximumDistanceMeters }
      if (initPayload && !workerReady) await initializeWorker()
      try {
        return await call('snap', payload, snapTimeoutMs)
      } catch (error) {
        if (!initPayload || !isRecoverableWorkerError(error)) throw error
        await initializeWorker()
        return call('snap', payload, snapTimeoutMs)
      }
    },
    calculateBundle(startIndex, destinationIndex, scenario) {
      return call('route', { startIndex, destinationIndex, scenario }, routeTimeoutMs)
    },
    dispose() {
      disposed = true
      const error = new RouteEngineError('路由引擎已经关闭。')
      for (const request of pending.values()) {
        clearTimeout(request.timer)
        request.reject(error)
      }
      pending.clear()
      worker?.terminate()
      worker = null
      workerReady = false
    },
  }
}
