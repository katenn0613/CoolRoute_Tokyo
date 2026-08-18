import { ROUTING_MODES } from './exposureModel.js'

export const PHASES = Object.freeze({
  AWAITING_START: 'awaiting-start',
  AWAITING_DESTINATION: 'awaiting-destination',
  ROUTE_READY: 'route-ready',
  SELECTING_START: 'selecting-start',
  SELECTING_DESTINATION: 'selecting-destination',
})

export function createInitialSelectionState() {
  return {
    phase: PHASES.AWAITING_START,
    start: null,
    destination: null,
    route: null,
    selectedMode: ROUTING_MODES.BALANCED,
    error: null,
  }
}

export function getSelectionPrompt(phase) {
  const prompts = {
    [PHASES.AWAITING_START]: '地図上で出発地を選択してください',
    [PHASES.AWAITING_DESTINATION]: '地図上で目的地を選択してください',
    [PHASES.ROUTE_READY]: '3つのルートを比較できます',
    [PHASES.SELECTING_START]: '新しい出発地を選択してください',
    [PHASES.SELECTING_DESTINATION]: '新しい目的地を選択してください',
  }
  return prompts[phase] ?? '別の地点を選択してください。'
}

export function selectionReducer(state, event) {
  switch (event.type) {
    case 'START_COMMITTED':
      if (state.phase !== PHASES.AWAITING_START) return state
      return {
        ...state,
        phase: PHASES.AWAITING_DESTINATION,
        start: event.start,
        error: null,
      }
    case 'DESTINATION_AND_ROUTE_COMMITTED':
      if (
        state.phase !== PHASES.AWAITING_DESTINATION
        && state.phase !== PHASES.SELECTING_DESTINATION
      ) return state
      return {
        ...state,
        phase: PHASES.ROUTE_READY,
        destination: event.destination,
        route: event.route,
        error: null,
      }
    case 'START_AND_ROUTE_COMMITTED':
      if (state.phase !== PHASES.SELECTING_START) return state
      return {
        ...state,
        phase: PHASES.ROUTE_READY,
        start: event.start,
        route: event.route,
        error: null,
      }
    case 'ROUTE_RECALCULATED':
      if (state.phase !== PHASES.ROUTE_READY) return state
      return { ...state, route: event.route, error: null }
    case 'ROUTE_MODE_SELECTED':
      if (!Object.values(ROUTING_MODES).includes(event.mode)) return state
      return { ...state, selectedMode: event.mode, error: null }
    case 'SELECT_START_REQUESTED':
      if (state.phase !== PHASES.ROUTE_READY || !state.start || !state.destination) return state
      return { ...state, phase: PHASES.SELECTING_START, error: null }
    case 'SELECT_DESTINATION_REQUESTED':
      if (state.phase !== PHASES.ROUTE_READY || !state.start || !state.destination) return state
      return { ...state, phase: PHASES.SELECTING_DESTINATION, error: null }
    case 'CANDIDATE_REJECTED':
      return { ...state, error: event.error }
    case 'RESET':
      return createInitialSelectionState()
    default:
      return state
  }
}
