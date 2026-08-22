import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { demoArea } from '../config/demoArea.js'
import { routingConfig } from '../config/routingConfig.js'
import { shadeConfig } from '../config/shadeConfig.js'
import { calculateRouteBundle } from './calculateRouteBundle.js'
import { buildExposureFeatureCollection } from './exposureLayer.js'
import { loadRoadGraph } from './graphLoader.js'
import { findNearestNode } from './nearestNode.js'
import { useShadeLayer } from '../shade/useShadeLayer.js'
import { createRouteEngine } from './routeEngine.js'
import {
  PHASES,
  createInitialSelectionState,
  getSelectionPrompt,
  selectionReducer,
} from './selectionMachine.js'
import { toUserRoutingMessage } from './userMessages.js'

class RoutingInteractionError extends Error {}

export function useRouteBundle({ loadGraph, loadShade, engine } = {}) {
  const workerMode = loadGraph === undefined && loadShade === undefined
  const engineRef = useRef(null)
  if (workerMode && engineRef.current === null) {
    engineRef.current = engine ?? createRouteEngine({ boundingBox: demoArea.boundingBox })
  }
  const graphRef = useRef(null)
  const busyRef = useRef(false)
  const [selection, dispatch] = useReducer(selectionReducer, undefined, createInitialSelectionState)
  const [graphState, setGraphState] = useState({ status: 'loading', loadTimeMs: null, error: null })
  const [exposureGeoJSON, setExposureGeoJSON] = useState(null)
  const [isCalculating, setIsCalculating] = useState(false)
  const [shadeReady, setShadeReady] = useState(false)
  const [shadeCoverage, setShadeCoverage] = useState(null)
  const [shadeScenarioState, setShadeScenarioState] = useState(shadeConfig.defaultScenario)
  const shadeState = useShadeLayer({
    graph: workerMode ? null : graphState.status === 'ready' ? graphRef.current : null,
    loadShade,
  })

  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const shadeScenarioRef = useRef(shadeScenarioState)
  shadeScenarioRef.current = shadeScenarioState

  useEffect(() => {
    let active = true
    setGraphState({ status: 'loading', loadTimeMs: null, error: null })
    if (workerMode) {
      engineRef.current.init()
        .then((info) => {
          if (!active) return
          setShadeReady(true)
          if (info.shadeCoverage) setShadeCoverage(info.shadeCoverage)
          setGraphState({ status: 'ready', loadTimeMs: info.loadTimeMs, error: null })
        })
        .catch((error) => {
          if (!active) return
          setGraphState({
            status: 'error',
            loadTimeMs: null,
            error: toUserRoutingMessage(error, 'graph-load'),
          })
        })
      return () => { active = false }
    }
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
  }, [loadGraph, workerMode])

  // ---- Legacy（同步）路径：测试注入 loadGraph/loadShade 时使用 ----
  const snapPointSync = useCallback((point) => {
    if (!graphRef.current) throw new RoutingInteractionError('Road Graph is not ready.')
    return findNearestNode(graphRef.current, point, {
      boundingBox: demoArea.boundingBox,
      maximumDistanceMeters: routingConfig.maximumSnapDistanceMeters,
    })
  }, [])

  const calculateSync = useCallback((start, destination, shadeContext) => {
    setIsCalculating(true)
    try {
      return calculateRouteBundle(
        graphRef.current,
        start.node.id,
        destination.node.id,
        routingConfig,
        shadeContext ?? null,
      )
    } finally {
      setIsCalculating(false)
    }
  }, [])

  // ---- Worker（异步）路径：生产模式使用 ----
  const snapPointAsync = useCallback(async (point) => {
    const snapped = await engineRef.current.snap(
      point,
      routingConfig.maximumSnapDistanceMeters,
    )
    return {
      node: {
        id: String(snapped.index),
        index: snapped.index,
        lon: snapped.lon,
        lat: snapped.lat,
      },
      distanceMeters: snapped.distanceMeters,
      clickedPoint: [...point],
    }
  }, [])

  const calculateAsync = useCallback(async (start, destination, scenario) => {
    setIsCalculating(true)
    try {
      return await engineRef.current.calculateBundle(
        start.node.index,
        destination.node.index,
        scenario ?? shadeScenarioRef.current,
      )
    } finally {
      setIsCalculating(false)
    }
  }, [])

  const handleWorkerMapClick = useCallback(async (point) => {
    if (busyRef.current) return
    busyRef.current = true
    try {
      const phase = selectionRef.current.phase
      if (phase === PHASES.AWAITING_START) {
        const candidate = await snapPointAsync(point)
        dispatch({ type: 'START_COMMITTED', start: candidate })
        return
      }
      if (phase === PHASES.AWAITING_DESTINATION) {
        const candidate = await snapPointAsync(point)
        const route = await calculateAsync(selectionRef.current.start, candidate)
        dispatch({ type: 'DESTINATION_AND_ROUTE_COMMITTED', destination: candidate, route })
        return
      }
      if (phase === PHASES.SELECTING_START) {
        const candidate = await snapPointAsync(point)
        const route = await calculateAsync(candidate, selectionRef.current.destination)
        dispatch({ type: 'START_AND_ROUTE_COMMITTED', start: candidate, route })
        return
      }
      if (phase === PHASES.SELECTING_DESTINATION) {
        const candidate = await snapPointAsync(point)
        const route = await calculateAsync(selectionRef.current.start, candidate)
        dispatch({ type: 'DESTINATION_AND_ROUTE_COMMITTED', destination: candidate, route })
      }
    } catch (error) {
      dispatch({ type: 'CANDIDATE_REJECTED', error: toUserRoutingMessage(error) })
    } finally {
      busyRef.current = false
    }
  }, [calculateAsync, snapPointAsync])

  const handleMapClick = useCallback((point) => {
    if (graphState.status !== 'ready' || selection.phase === PHASES.ROUTE_READY) return
    if (workerMode) {
      handleWorkerMapClick(point)
      return
    }
    try {
      const candidate = snapPointSync(point)
      if (selection.phase === PHASES.AWAITING_START) {
        dispatch({ type: 'START_COMMITTED', start: candidate })
        return
      }
      if (selection.phase === PHASES.AWAITING_DESTINATION) {
        dispatch({
          type: 'DESTINATION_AND_ROUTE_COMMITTED',
          destination: candidate,
          route: calculateSync(selection.start, candidate),
        })
        return
      }
      if (selection.phase === PHASES.SELECTING_START) {
        dispatch({
          type: 'START_AND_ROUTE_COMMITTED',
          start: candidate,
          route: calculateSync(candidate, selection.destination),
        })
        return
      }
      if (selection.phase === PHASES.SELECTING_DESTINATION) {
        dispatch({
          type: 'DESTINATION_AND_ROUTE_COMMITTED',
          destination: candidate,
          route: calculateSync(selection.start, candidate),
        })
      }
    } catch (error) {
      dispatch({ type: 'CANDIDATE_REJECTED', error: toUserRoutingMessage(error) })
    }
  }, [calculateSync, graphState.status, selection, snapPointSync, workerMode, handleWorkerMapClick])

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
    if (workerMode) {
      const { start, destination } = selectionRef.current
      if (!start || !destination || graphState.status !== 'ready') return
      if (busyRef.current) return
      busyRef.current = true
      calculateAsync(start, destination, shadeScenarioRef.current)
        .then((route) => dispatch({ type: 'ROUTE_RECALCULATED', route }))
        .catch((error) => dispatch({ type: 'CANDIDATE_REJECTED', error: toUserRoutingMessage(error) }))
        .finally(() => { busyRef.current = false })
      return
    }
    if (!selection.start || !selection.destination || graphState.status !== 'ready') return
    try {
      dispatch({
        type: 'ROUTE_RECALCULATED',
        route: calculateSync(selection.start, selection.destination),
      })
    } catch (error) {
      dispatch({ type: 'CANDIDATE_REJECTED', error: toUserRoutingMessage(error) })
    }
  }, [calculateAsync, calculateSync, graphState.status, selection.destination, selection.start, workerMode])

  const changeShadeScenario = useCallback((nextScenario) => {
    if (workerMode) {
      setShadeScenarioState(nextScenario)
      const { start, destination } = selectionRef.current
      if (!start || !destination || graphState.status !== 'ready') return
      if (busyRef.current) return
      busyRef.current = true
      calculateAsync(start, destination, nextScenario)
        .then((route) => dispatch({ type: 'ROUTE_RECALCULATED', route }))
        .catch((error) => dispatch({ type: 'CANDIDATE_REJECTED', error: toUserRoutingMessage(error) }))
        .finally(() => { busyRef.current = false })
      return
    }
    try {
      const candidateContext = shadeState.createRoutingContext(nextScenario)
      if (selection.start && selection.destination && graphState.status === 'ready') {
        dispatch({
          type: 'ROUTE_RECALCULATED',
          route: calculateSync(selection.start, selection.destination, candidateContext),
        })
      }
      shadeState.commitScenario(nextScenario)
    } catch (error) {
      dispatch({ type: 'CANDIDATE_REJECTED', error: toUserRoutingMessage(error) })
    }
  }, [calculateSync, graphState.status, selection.destination, selection.start, shadeState, workerMode, calculateAsync])

  useEffect(() => {
    if (
      workerMode
      || !shadeState.routingContext
      || !selection.route
      || !selection.start
      || !selection.destination
      || selection.route.routes.fastest.metrics.shadeScenario === shadeState.scenario
    ) return
    try {
      dispatch({
        type: 'ROUTE_RECALCULATED',
        route: calculateSync(selection.start, selection.destination, shadeState.routingContext),
      })
    } catch (error) {
      dispatch({ type: 'CANDIDATE_REJECTED', error: toUserRoutingMessage(error) })
    }
  }, [calculateSync, selection.destination, selection.route, selection.start, shadeState.routingContext, shadeState.scenario, workerMode])

  const prompt = graphState.status === 'loading'
    ? '道路データを読み込んでいます…'
    : graphState.status === 'error'
      ? '道路データを利用できません。'
      : isCalculating
        ? 'ルートを計算しています…'
        : getSelectionPrompt(selection.phase)
  const selectedRoute = selection.route?.routes?.[selection.selectedMode] ?? null
  const shadeStatus = workerMode
    ? (shadeReady ? 'ready' : graphState.status === 'error' ? 'error' : 'loading')
    : shadeState.status
  const routingEnvironmentStatus = workerMode
    ? (shadeReady ? 'shade-aware' : 'base-only')
    : shadeState.routingContext
      ? 'shade-aware'
      : shadeState.status === 'error'
        ? 'base-only'
        : 'loading'

  return {
    ...selection,
    graphStatus: graphState.status,
    graphLoadTimeMs: graphState.loadTimeMs,
    roadGraph: workerMode ? null : graphRef.current,
    exposureGeoJSON,
    isCalculating,
    error: graphState.error ?? selection.error,
    prompt,
    routes: selection.route?.routes ?? null,
    comparisons: selection.route?.comparisons ?? null,
    shadeAwareComparisons: selection.route?.shadeAwareComparisons ?? null,
    routeCalculationTimeMs: selection.route?.totalCalculationTimeMs ?? null,
    metrics: selectedRoute?.metrics ?? null,
    routeGeoJSON: selectedRoute?.geoJSON ?? null,
    shadeGeoJSON: workerMode ? null : shadeState.geoJSON,
    shadeStatus,
    shadeError: workerMode ? null : shadeState.error,
    shadeCoverage: workerMode ? shadeCoverage : shadeState.coverage,
    shadeScenario: workerMode ? shadeScenarioState : shadeState.scenario,
    routingEnvironmentStatus,
    changeShadeScenario,
    handleMapClick,
    selectStart,
    selectDestination,
    reset,
    recalculate,
    selectMode,
  }
}
