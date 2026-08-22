import { useCallback, useEffect, useMemo, useState } from 'react'
import { shadeConfig } from '../config/shadeConfig.js'
import { createShadeContext } from '../routing/shadeContext.js'
import { buildShadeFeatureCollection } from './shadeLayer.js'
import { loadShadeData, validateShadePayload } from './shadeLoader.js'

export function useShadeLayer({ graph, loadShade = loadShadeData } = {}) {
  const [state, setState] = useState({ status: 'idle', payload: null, error: null })
  const [scenario, setScenarioState] = useState(shadeConfig.defaultScenario)

  useEffect(() => {
    let active = true
    if (!graph) {
      setState({ status: 'idle', payload: null, error: null })
      return () => { active = false }
    }
    setState({ status: 'loading', payload: null, error: null })
    loadShade()
      .then((payload) => {
        if (!active) return
        setState({ status: 'ready', payload: validateShadePayload(payload, graph), error: null })
      })
      .catch(() => {
        if (!active) return
        setState({ status: 'error', payload: null, error: '日陰データを利用できません。' })
      })
    return () => { active = false }
  }, [graph, loadShade])

  const createRoutingContext = useCallback((nextScenario) => {
    if (!shadeConfig.scenarios.includes(nextScenario)) {
      throw new RangeError(`不支持的 Shade 场景：${nextScenario}`)
    }
    if (state.status !== 'ready') {
      throw new Error('Shade Routing Context 尚未就绪。')
    }
    return createShadeContext(state.payload, nextScenario)
  }, [state.payload, state.status])
  const commitScenario = useCallback((nextScenario) => {
    createRoutingContext(nextScenario)
    setScenarioState(nextScenario)
  }, [createRoutingContext])
  const routingContext = useMemo(
    () => state.status === 'ready' ? createShadeContext(state.payload, scenario) : null,
    [scenario, state.payload, state.status],
  )
  const geoJSON = useMemo(
    () => state.status === 'ready'
      ? buildShadeFeatureCollection(graph, state.payload, scenario)
      : null,
    [graph, scenario, state.payload, state.status],
  )
  const coverage = state.status === 'ready'
    ? state.payload.metadata.quality ?? null
    : null
  return {
    status: state.status,
    error: state.error,
    scenario,
    setScenario: commitScenario,
    commitScenario,
    createRoutingContext,
    routingContext,
    geoJSON,
    coverage,
  }
}
