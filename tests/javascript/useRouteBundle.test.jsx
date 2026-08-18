import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PHASES } from '../../src/routing/selectionMachine.js'
import { useRouteBundle } from '../../src/routing/useRouteBundle.js'
import { createSyntheticRoadGraph } from './fixtures/syntheticRoadGraph.js'

function successfulLoader() {
  return Promise.resolve({ graph: createSyntheticRoadGraph(), loadTimeMs: 12.5 })
}

describe('useRouteBundle', () => {
  it('loads one graph and calculates all three routes after the second valid click', async () => {
    const graph = createSyntheticRoadGraph()
    const loadGraph = () => Promise.resolve({ graph, loadTimeMs: 12.5 })
    const { result } = renderHook(() => useRouteBundle({ loadGraph }))
    await waitFor(() => expect(result.current.graphStatus).toBe('ready'))
    expect(result.current.roadGraph).toBe(graph)
    expect(result.current.exposureGeoJSON.features).toHaveLength(graph.edges.size)

    act(() => result.current.handleMapClick([139.75, 35.68]))
    expect(result.current.phase).toBe(PHASES.AWAITING_DESTINATION)
    act(() => result.current.handleMapClick([139.753, 35.682]))

    expect(result.current.phase).toBe(PHASES.ROUTE_READY)
    expect(Object.keys(result.current.routes)).toEqual(['fastest', 'balanced', 'coolest'])
    expect(result.current.selectedMode).toBe('balanced')
    expect(result.current.metrics.distanceMeters).toBe(7)
  })

  it('switches the selected route without replacing or recalculating the bundle', async () => {
    const { result } = renderHook(() => useRouteBundle({ loadGraph: successfulLoader }))
    await waitFor(() => expect(result.current.graphStatus).toBe('ready'))
    act(() => result.current.handleMapClick([139.75, 35.68]))
    act(() => result.current.handleMapClick([139.753, 35.682]))
    const bundle = result.current.route
    const calculationTime = result.current.routeCalculationTimeMs

    act(() => result.current.selectMode('coolest'))

    expect(result.current.route).toBe(bundle)
    expect(result.current.routeCalculationTimeMs).toBe(calculationTime)
    expect(result.current.selectedMode).toBe('coolest')
    expect(result.current.metrics.distanceMeters).toBe(14)
  })

  it('keeps the old route and shows Japanese user errors for invalid replacements', async () => {
    const { result } = renderHook(() => useRouteBundle({ loadGraph: successfulLoader }))
    await waitFor(() => expect(result.current.graphStatus).toBe('ready'))
    act(() => result.current.handleMapClick([139.75, 35.68]))
    act(() => result.current.handleMapClick([139.753, 35.682]))
    const oldStart = result.current.start
    const oldRoute = result.current.route

    act(() => result.current.selectStart())
    act(() => result.current.handleMapClick([139.743, 35.68]))

    expect(result.current.phase).toBe(PHASES.SELECTING_START)
    expect(result.current.start).toBe(oldStart)
    expect(result.current.route).toBe(oldRoute)
    expect(result.current.error).toBe('対象エリア内の道路付近を選択してください。')
  })

  it('keeps the old destination and route when the replacement is unreachable', async () => {
    const { result } = renderHook(() => useRouteBundle({ loadGraph: successfulLoader }))
    await waitFor(() => expect(result.current.graphStatus).toBe('ready'))
    act(() => result.current.handleMapClick([139.75, 35.68]))
    act(() => result.current.handleMapClick([139.753, 35.682]))
    const oldDestination = result.current.destination
    const oldRoute = result.current.route

    act(() => result.current.selectDestination())
    act(() => result.current.handleMapClick([139.76, 35.69]))

    expect(result.current.phase).toBe(PHASES.SELECTING_DESTINATION)
    expect(result.current.destination).toBe(oldDestination)
    expect(result.current.route).toBe(oldRoute)
    expect(result.current.error).toBe('ルートを見つけることができませんでした。')
  })

  it('reset clears points and restores Balanced', async () => {
    const { result } = renderHook(() => useRouteBundle({ loadGraph: successfulLoader }))
    await waitFor(() => expect(result.current.graphStatus).toBe('ready'))
    act(() => result.current.selectMode('coolest'))
    act(() => result.current.handleMapClick([139.75, 35.68]))
    act(() => result.current.reset())

    expect(result.current.phase).toBe(PHASES.AWAITING_START)
    expect(result.current.start).toBeNull()
    expect(result.current.destination).toBeNull()
    expect(result.current.route).toBeNull()
    expect(result.current.selectedMode).toBe('balanced')
  })
})
