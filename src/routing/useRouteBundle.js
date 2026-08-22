import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { requestedDatasetId, resolveDataset } from '../config/datasetConfig.js'
import { routingConfig } from '../config/routingConfig.js'
import { shadeConfig } from '../config/shadeConfig.js'
import { useShadeLayer } from '../shade/useShadeLayer.js'
import { calculateRouteBundle } from './calculateRouteBundle.js'
import { buildExposureFeatureCollection } from './exposureLayer.js'
import { loadRoadGraph } from './graphLoader.js'
import { findNearestNode, PointOutsideDemoAreaError } from './nearestNode.js'
import { createRouteEngine } from './routeEngine.js'
import { isPointInServiceArea, loadServiceArea } from './serviceArea.js'
import {
  PHASES,
  createInitialSelectionState,
  getSelectionPrompt,
  selectionReducer,
} from './selectionMachine.js'
import { toUserRoutingMessage } from './userMessages.js'

class RoutingInteractionError extends Error {}

export function useRouteBundle({
  datasetId = requestedDatasetId(),
  loadGraph,
  loadShade,
  loadArea = null,
  engine,
  fallbackLoadGraph,
  fallbackLoadArea,
} = {}) {
  const requestedDataset = resolveDataset(datasetId)
  const startsInWorkerMode = requestedDataset.runtime === 'binary-worker' && loadGraph === undefined
  const [activeDataset, setActiveDataset] = useState(requestedDataset)
  const workerMode = activeDataset.runtime === 'binary-worker'
  const engineRef = useRef(null)
  if (startsInWorkerMode && engineRef.current === null) {
    engineRef.current = engine ?? createRouteEngine({
      boundingBox: requestedDataset.area.boundingBox,
    })
  }

  const graphRef = useRef(null)
  const serviceAreaRef = useRef(null)
  const busyRef = useRef(false)
  const [selection, dispatch] = useReducer(selectionReducer, undefined, createInitialSelectionState)
  const [graphState, setGraphState] = useState({ status: 'loading', loadTimeMs: null, error: null })
  const [exposureGeoJSON, setExposureGeoJSON] = useState(null)
  const [isCalculating, setIsCalculating] = useState(false)
  const [workerShade, setWorkerShade] = useState({ ready: false, coverage: null })
  const [workerShadeScenario, setWorkerShadeScenario] = useState(shadeConfig.defaultScenario)
  const shadeState = useShadeLayer({
    graph: workerMode || graphState.status !== 'ready' ? null : graphRef.current,
    loadShade,
  })
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const shadeScenarioRef = useRef(workerShadeScenario)
  shadeScenarioRef.current = workerShadeScenario

  useEffect(() => {
    let active = true
    setGraphState({ status: 'loading', loadTimeMs: null, error: null })

    const commitLegacyGraph = (dataset, graphResult, serviceArea) => {
      if (!active) return
      graphRef.current = graphResult.graph
      serviceAreaRef.current = serviceArea
      setActiveDataset(dataset)
      setExposureGeoJSON(buildExposureFeatureCollection(graphResult.graph, routingConfig))
      setGraphState({ status: 'ready', loadTimeMs: graphResult.loadTimeMs, error: null })
    }
    const rejectGraph = (error) => {
      if (!active) return
      graphRef.current = null
      serviceAreaRef.current = null
      setExposureGeoJSON(null)
      setGraphState({
        status: 'error',
        loadTimeMs: null,
        error: toUserRoutingMessage(error, 'graph-load'),
      })
    }

    if (startsInWorkerMode) {
      engineRef.current.init()
        .then((info) => {
          if (!active) return
          setWorkerShade({ ready: info.shadeAvailable === true, coverage: info.shadeCoverage ?? null })
          setGraphState({ status: 'ready', loadTimeMs: info.loadTimeMs, error: null })
        })
        .catch(() => {
          const fallbackDataset = resolveDataset(requestedDataset.fallbackId)
          const graphLoader = fallbackLoadGraph ?? loadRoadGraph
          const areaLoader = fallbackLoadArea ?? (fallbackLoadGraph ? null : loadServiceArea)
          return Promise.all([
            graphLoader(),
            areaLoader ? areaLoader() : Promise.resolve(null),
          ]).then(([graphResult, serviceArea]) => {
            commitLegacyGraph(fallbackDataset, graphResult, serviceArea)
          })
        })
        .catch(rejectGraph)
    } else {
      const graphLoader = loadGraph ?? loadRoadGraph
      const areaLoader = loadArea ?? (graphLoader === loadRoadGraph ? loadServiceArea : null)
      Promise.all([
        graphLoader(),
        areaLoader ? areaLoader() : Promise.resolve(null),
      ])
        .then(([graphResult, serviceArea]) => {
          commitLegacyGraph(requestedDataset, graphResult, serviceArea)
        })
        .catch(rejectGraph)
    }

    return () => {
      active = false
      graphRef.current = null
      serviceAreaRef.current = null
      if (startsInWorkerMode) engineRef.current?.dispose()
    }
  }, [
    fallbackLoadArea,
    fallbackLoadGraph,
    loadArea,
    loadGraph,
    requestedDataset,
    startsInWorkerMode,
  ])

  const snapPointSync = useCallback((point) => {
    if (!graphRef.current) throw new RoutingInteractionError('Road Graph is not ready.')
    if (serviceAreaRef.current && !isPointInServiceArea(point, serviceAreaRef.current)) {
      throw new PointOutsideDemoAreaError()
    }
    const snapped = findNearestNode(graphRef.current, point, {
      boundingBox: activeDataset.area.boundingBox,
      maximumDistanceMeters: routingConfig.maximumSnapDistanceMeters,
    })
    return { ...snapped, clickedPoint: [...point] }
  }, [activeDataset.area.boundingBox])

  const calculateSync = useCallback((start, destination, shadeContext = shadeState.routingContext) => {
    setIsCalculating(true)
    try {
      return calculateRouteBundle(
        graphRef.current,
        start.node.id,
        destination.node.id,
        routingConfig,
        shadeContext,
      )
    } finally {
      setIsCalculating(false)
    }
  }, [shadeState.routingContext])

  const snapPointAsync = useCallback(async (point) => {
    const snapped = await engineRef.current.snap(point, routingConfig.maximumSnapDistanceMeters)
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
      const current = selectionRef.current
      const candidate = await snapPointAsync(point)
      if (current.phase === PHASES.AWAITING_START) {
        dispatch({ type: 'START_COMMITTED', start: candidate })
      } else if (current.phase === PHASES.AWAITING_DESTINATION) {
        const route = await calculateAsync(current.start, candidate)
        dispatch({ type: 'DESTINATION_AND_ROUTE_COMMITTED', destination: candidate, route })
      } else if (current.phase === PHASES.SELECTING_START) {
        const route = await calculateAsync(candidate, current.destination)
        dispatch({ type: 'START_AND_ROUTE_COMMITTED', start: candidate, route })
      } else if (current.phase === PHASES.SELECTING_DESTINATION) {
        const route = await calculateAsync(current.start, candidate)
        dispatch({ type: 'DESTINATION_AND_ROUTE_COMMITTED', destination: candidate, route })
      }
    } catch (error) {
      dispatch({ type: 'CANDIDATE_REJECTED', error: toUserRoutingMessage(error) })
    } finally {
      busyRef.current = false
    }
  }, [calculateAsync, snapPointAsync])

  const handleMapClick = useCallback((point) => {
    if (graphState.status !== 'ready' || selection.phase === PHASES.ROUTE_READY) return undefined
    if (workerMode) return handleWorkerMapClick(point)
    try {
      const candidate = snapPointSync(point)
      if (selection.phase === PHASES.AWAITING_START) {
        dispatch({ type: 'START_COMMITTED', start: candidate })
      } else if (selection.phase === PHASES.AWAITING_DESTINATION) {
        dispatch({
          type: 'DESTINATION_AND_ROUTE_COMMITTED', destination: candidate,
          route: calculateSync(selection.start, candidate),
        })
      } else if (selection.phase === PHASES.SELECTING_START) {
        dispatch({
          type: 'START_AND_ROUTE_COMMITTED', start: candidate,
          route: calculateSync(candidate, selection.destination),
        })
      } else if (selection.phase === PHASES.SELECTING_DESTINATION) {
        dispatch({
          type: 'DESTINATION_AND_ROUTE_COMMITTED', destination: candidate,
          route: calculateSync(selection.start, candidate),
        })
      }
    } catch (error) {
      dispatch({ type: 'CANDIDATE_REJECTED', error: toUserRoutingMessage(error) })
    }
    return undefined
  }, [calculateSync, graphState.status, handleWorkerMapClick, selection, snapPointSync, workerMode])

  const selectStart = useCallback(() => dispatch({ type: 'SELECT_START_REQUESTED' }), [])
  const selectDestination = useCallback(() => dispatch({ type: 'SELECT_DESTINATION_REQUESTED' }), [])
  const reset = useCallback(() => dispatch({ type: 'RESET' }), [])
  const selectMode = useCallback((mode) => dispatch({ type: 'ROUTE_MODE_SELECTED', mode }), [])

  const recalculate = useCallback(() => {
    const current = selectionRef.current
    if (!current.start || !current.destination || graphState.status !== 'ready') return undefined
    if (!workerMode) {
      try {
        dispatch({ type: 'ROUTE_RECALCULATED', route: calculateSync(current.start, current.destination) })
      } catch (error) {
        dispatch({ type: 'CANDIDATE_REJECTED', error: toUserRoutingMessage(error) })
      }
      return undefined
    }
    if (busyRef.current) return undefined
    busyRef.current = true
    return calculateAsync(current.start, current.destination, shadeScenarioRef.current)
      .then((route) => dispatch({ type: 'ROUTE_RECALCULATED', route }))
      .catch((error) => dispatch({ type: 'CANDIDATE_REJECTED', error: toUserRoutingMessage(error) }))
      .finally(() => { busyRef.current = false })
  }, [calculateAsync, calculateSync, graphState.status, workerMode])

  const changeShadeScenario = useCallback((nextScenario) => {
    const current = selectionRef.current
    if (!workerMode) {
      try {
        const candidateContext = shadeState.createRoutingContext(nextScenario)
        if (current.start && current.destination && graphState.status === 'ready') {
          dispatch({
            type: 'ROUTE_RECALCULATED',
            route: calculateSync(current.start, current.destination, candidateContext),
          })
        }
        shadeState.commitScenario(nextScenario)
      } catch (error) {
        dispatch({ type: 'CANDIDATE_REJECTED', error: toUserRoutingMessage(error) })
      }
      return undefined
    }
    if (!shadeConfig.scenarios.includes(nextScenario) || busyRef.current) return undefined
    if (!current.start || !current.destination || graphState.status !== 'ready') {
      setWorkerShadeScenario(nextScenario)
      return undefined
    }
    busyRef.current = true
    return calculateAsync(current.start, current.destination, nextScenario)
      .then((route) => {
        dispatch({ type: 'ROUTE_RECALCULATED', route })
        setWorkerShadeScenario(nextScenario)
      })
      .catch((error) => dispatch({ type: 'CANDIDATE_REJECTED', error: toUserRoutingMessage(error) }))
      .finally(() => { busyRef.current = false })
  }, [calculateAsync, calculateSync, graphState.status, shadeState, workerMode])

  useEffect(() => {
    if (
      workerMode || !shadeState.routingContext || !selection.route || !selection.start
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
      : isCalculating ? 'ルートを計算しています…' : getSelectionPrompt(selection.phase)
  const selectedRoute = selection.route?.routes?.[selection.selectedMode] ?? null
  const shadeStatus = workerMode
    ? workerShade.ready ? 'ready' : graphState.status === 'error' ? 'error' : 'loading'
    : shadeState.status

  return {
    ...selection,
    datasetId: activeDataset.id,
    dataset: activeDataset,
    datasetLabel: activeDataset.label,
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
    shadeCoverage: workerMode ? workerShade.coverage : shadeState.coverage,
    shadeScenario: workerMode ? workerShadeScenario : shadeState.scenario,
    routingEnvironmentStatus: workerMode
      ? workerShade.ready ? 'shade-aware' : 'loading'
      : shadeState.routingContext ? 'shade-aware' : shadeState.status === 'error' ? 'base-only' : 'loading',
    changeShadeScenario,
    handleMapClick,
    selectStart,
    selectDestination,
    reset,
    recalculate,
    selectMode,
  }
}
