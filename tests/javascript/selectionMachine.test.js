import { describe, expect, it } from 'vitest'
import {
  PHASES,
  createInitialSelectionState,
  getSelectionPrompt,
  selectionReducer,
} from '../../src/routing/selectionMachine.js'
import { ROUTING_MODES } from '../../src/routing/exposureModel.js'

const start = { node: { id: 'a', lon: 139.75, lat: 35.68 }, distanceMeters: 1 }
const destination = { node: { id: 'd', lon: 139.753, lat: 35.682 }, distanceMeters: 2 }
const route = { metrics: { distanceMeters: 7, walkingTimeSeconds: 5, edgeCount: 2 } }

describe('Route selection state machine', () => {
  it('moves through awaiting-start, awaiting-destination and route-ready', () => {
    const initial = createInitialSelectionState()
    const withStart = selectionReducer(initial, { type: 'START_COMMITTED', start })
    const ready = selectionReducer(withStart, {
      type: 'DESTINATION_AND_ROUTE_COMMITTED',
      destination,
      route,
    })

    expect(initial.phase).toBe(PHASES.AWAITING_START)
    expect(initial.selectedMode).toBe(ROUTING_MODES.BALANCED)
    expect(withStart).toMatchObject({ phase: PHASES.AWAITING_DESTINATION, start })
    expect(ready).toMatchObject({ phase: PHASES.ROUTE_READY, start, destination, route })
  })

  it('enters explicit reselect modes and exposes an unambiguous prompt', () => {
    const ready = { ...createInitialSelectionState(), phase: PHASES.ROUTE_READY, start, destination, route }

    const selectingStart = selectionReducer(ready, { type: 'SELECT_START_REQUESTED' })
    const selectingDestination = selectionReducer(ready, { type: 'SELECT_DESTINATION_REQUESTED' })

    expect(selectingStart.phase).toBe(PHASES.SELECTING_START)
    expect(getSelectionPrompt(selectingStart.phase)).toBe('新しい出発地を選択してください')
    expect(selectingDestination.phase).toBe(PHASES.SELECTING_DESTINATION)
    expect(getSelectionPrompt(selectingDestination.phase)).toBe('新しい目的地を選択してください')
  })

  it('keeps the previous valid points and route when a replacement fails', () => {
    const selecting = {
      ...createInitialSelectionState(),
      phase: PHASES.SELECTING_START,
      start,
      destination,
      route,
    }

    const failed = selectionReducer(selecting, {
      type: 'CANDIDATE_REJECTED',
      error: '新起点无效',
    })

    expect(failed).toMatchObject({
      phase: PHASES.SELECTING_START,
      start,
      destination,
      route,
      error: '新起点无效',
    })
  })

  it('resets every selection field and phase', () => {
    const ready = {
      phase: PHASES.ROUTE_READY,
      start,
      destination,
      route,
      error: 'old error',
    }

    expect(selectionReducer(ready, { type: 'RESET' })).toEqual(createInitialSelectionState())
  })

  it('switches the selected route mode only after a route bundle is ready', () => {
    const ready = {
      ...createInitialSelectionState(), phase: PHASES.ROUTE_READY, start, destination, route,
    }
    const selected = selectionReducer(ready, {
      type: 'ROUTE_MODE_SELECTED', mode: ROUTING_MODES.COOLEST,
    })
    expect(selected.selectedMode).toBe(ROUTING_MODES.COOLEST)
    expect(selected.route).toBe(route)
    expect(selectionReducer(createInitialSelectionState(), {
      type: 'ROUTE_MODE_SELECTED', mode: ROUTING_MODES.COOLEST,
    }).selectedMode).toBe(ROUTING_MODES.COOLEST)
  })
})
