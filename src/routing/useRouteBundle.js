import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { demoArea } from '../config/demoArea.js'
import { routingConfig } from '../config/routingConfig.js'
import { calculateRouteBundle } from './calculateRouteBundle.js'
import { buildExposureFeatureCollection } from './exposureLayer.js'
import { loadRoadGraph } from './graphLoader.js'
import { findNearestNode } from './nearestNode.js'
import {
  PHASES,
  createInitialSelectionState,
  getSelectionPrompt,
  selectionReducer,
} from './selectionMachine.js'
import { toUserRoutingMessage } from './userMessages.js'

class RoutingInteractionError extends Error {}

export function useRouteBundle({ loadGraph = loadRoadGraph } = {}) {
  const graphRef = useRef(null)
  const [selection, dispatch] = useReducer(selectionReducer, undefined, createInitialSelectionState)
  const [graphState, setGraphState] = useState({ status: 'loading', loadTimeMs: null, error: null })
  const [exposureGeoJSON, setExposureGeoJSON] = useState(null)
  const [isCalculating, setIsCalculating] = useState(false)

  useEffect(() => {
    let active = true
    setGraphState({ status: 'loading', loadTimeMs: null, error: null })
    loadGraph()
      .then(({ graph, loadTimeMs }) => {
        if (!active) return
        graphRef.current = graph
        setExposureGeoJSON(buildExposureFeatureCollection(graph, routingConfig))
        setGraphState({ status: 'ready', loadTimeMs, error: null })
      })
      .catch((error) => {
        if (!active) return
        graphRef.current = null
        setExposureGeoJSON(null)
        setGraphState({
          status: 'error',
          loadTimeMs: null,
          error: toUserRoutingMessage(error, 'graph-load'),
        })
      })
    return () => {
      active = false
      graphRef.current = null
    }
  }, [loadGraph])

  const snapPoint = useCallback((point) => {
    if (!graphRef.current) throw new RoutingInteractionError('Road Graph is not ready.')
    const snapped = findNearestNode(graphRef.current, point, {
      boundingBox: demoArea.boundingBox,
      maximumDistanceMeters: routingConfig.maximumSnapDistanceMeters,
    })
    return { ...snapped, clickedPoint: [...point] }
  }, [])

  const calculate = useCallback((start, destination) => {
    setIsCalculating(true)
    try {
      return calculateRouteBundle(graphRef.current, start.node.id, destination.node.id, routingConfig)
    } finally {
      setIsCalculating(false)
    }
  }, [])

  const handleMapClick = useCallback((point) => {
    if (graphState.status !== 'ready' || selection.phase === PHASES.ROUTE_READY) return
    try {
      const candidate = snapPoint(point)
      if (selection.phase === PHASES.AWAITING_START) {
        dispatch({ type: 'START_COMMITTED', start: candidate })
        return
      }
      if (selection.phase === PHASES.AWAITING_DESTINATION) {
        dispatch({
          type: 'DESTINATION_AND_ROUTE_COMMITTED',
          destination: candidate,
          route: calculate(selection.start, candidate),
        })
        return
      }
      if (selection.phase === PHASES.SELECTING_START) {
        dispatch({
          type: 'START_AND_ROUTE_COMMITTED',
          start: candidate,
          route: calculate(candidate, selection.destination),
        })
        return
      }
      if (selection.phase === PHASES.SELECTING_DESTINATION) {
        dispatch({
          type: 'DESTINATION_AND_ROUTE_COMMITTED',
          destination: candidate,
          route: calculate(selection.start, candidate),
        })
      }
    } catch (error) {
      dispatch({ type: 'CANDIDATE_REJECTED', error: toUserRoutingMessage(error) })
    }
  }, [calculate, graphState.status, selection, snapPoint])

  const selectStart = useCallback(() => dispatch({ type: 'SELECT_START_REQUESTED' }), [])
  const selectDestination = useCallback(
    () => dispatch({ type: 'SELECT_DESTINATION_REQUESTED' }),
    [],
  )
  const reset = useCallback(() => dispatch({ type: 'RESET' }), [])
  const selectMode = useCallback(
    (mode) => dispatch({ type: 'ROUTE_MODE_SELECTED', mode }),
    [],
  )
  const recalculate = useCallback(() => {
    if (!selection.start || !selection.destination || graphState.status !== 'ready') return
    try {
      dispatch({
        type: 'ROUTE_RECALCULATED',
        route: calculate(selection.start, selection.destination),
      })
    } catch (error) {
      dispatch({ type: 'CANDIDATE_REJECTED', error: toUserRoutingMessage(error) })
    }
  }, [calculate, graphState.status, selection.destination, selection.start])

  const prompt = graphState.status === 'loading'
    ? '道路データを読み込んでいます…'
    : graphState.status === 'error'
      ? '道路データを利用できません。'
      : isCalculating
        ? 'ルートを計算しています…'
        : getSelectionPrompt(selection.phase)
  const selectedRoute = selection.route?.routes?.[selection.selectedMode] ?? null

  return {
    ...selection,
    graphStatus: graphState.status,
    graphLoadTimeMs: graphState.loadTimeMs,
    roadGraph: graphRef.current,
    exposureGeoJSON,
    isCalculating,
    error: graphState.error ?? selection.error,
    prompt,
    routes: selection.route?.routes ?? null,
    comparisons: selection.route?.comparisons ?? null,
    routeCalculationTimeMs: selection.route?.totalCalculationTimeMs ?? null,
    metrics: selectedRoute?.metrics ?? null,
    routeGeoJSON: selectedRoute?.geoJSON ?? null,
    handleMapClick,
    selectStart,
    selectDestination,
    reset,
    recalculate,
    selectMode,
  }
}
