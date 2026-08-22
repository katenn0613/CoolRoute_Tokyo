import { describe, expect, it } from 'vitest'

import { RouteEngineError, createRouteEngine } from '../../src/routing/routeEngine.js'

class FakeWorker {
  messages = []
  terminated = false

  postMessage(message) {
    this.messages.push(message)
  }

  terminate() {
    this.terminated = true
  }

  respond(index, payload) {
    this.onmessage({ data: { id: this.messages[index].id, ...payload } })
  }
}

describe('Route Engine Worker client', () => {
  it('turns default assets into absolute URLs before sending them to the Worker', async () => {
    const worker = new FakeWorker()
    const engine = createRouteEngine({ workerFactory: () => worker })
    const pending = engine.init()

    expect(worker.messages[0].graphUrl).toMatch(/^https?:\/\//)
    expect(new URL(worker.messages[0].graphUrl).pathname).toMatch(/\/data\/graph_tokyo23\.bin\.gz$/)
    expect(new URL(worker.messages[0].rawGraphUrl).pathname).toMatch(/\/data\/graph_tokyo23\.bin$/)
    engine.dispose()
    await expect(pending).rejects.toEqual(expect.any(RouteEngineError))
  })

  it('passes init, snap and route requests through one worker', async () => {
    const worker = new FakeWorker()
    const engine = createRouteEngine({
      workerFactory: () => worker,
      graphUrl: '/graph.bin.gz',
      rawGraphUrl: '/graph.bin',
      shadeMetadataUrl: '/shade-meta.json',
      boundingBox: [139.5, 35.5, 140, 35.9],
    })

    const init = engine.init()
    expect(worker.messages[0]).toMatchObject({
      type: 'init', graphUrl: '/graph.bin.gz', rawGraphUrl: '/graph.bin',
    })
    worker.respond(0, { ok: true, nodeCount: 10, edgeCount: 20 })
    await expect(init).resolves.toMatchObject({ nodeCount: 10, edgeCount: 20 })

    const snap = engine.snap([139.7, 35.7], 200)
    expect(worker.messages[1]).toMatchObject({ type: 'snap', point: [139.7, 35.7], maxMeters: 200 })
    worker.respond(1, { ok: true, index: 4, lon: 139.7, lat: 35.7 })
    await expect(snap).resolves.toMatchObject({ index: 4 })

    const route = engine.calculateBundle(4, 8, '15:00')
    expect(worker.messages[2]).toMatchObject({
      type: 'route', startIndex: 4, destinationIndex: 8, scenario: '15:00',
    })
    worker.respond(2, { ok: true, routes: { fastest: {} } })
    await expect(route).resolves.toMatchObject({ routes: { fastest: {} } })
  })

  it('preserves worker error codes and rejects pending calls on crash', async () => {
    const worker = new FakeWorker()
    const engine = createRouteEngine({ workerFactory: () => worker })
    const routeError = engine.snap([139.7, 35.7], 200)
    worker.respond(0, { ok: false, error: { code: 'snap', message: '无法吸附' } })
    await expect(routeError).rejects.toMatchObject({
      name: 'RouteEngineError', code: 'snap', message: '无法吸附',
    })

    const pending = engine.init()
    worker.onerror({ message: 'worker crashed' })
    await expect(pending).rejects.toEqual(expect.any(RouteEngineError))
    engine.dispose()
    expect(worker.terminated).toBe(true)
  })
})
