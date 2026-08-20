import { useEffect, useMemo, useState } from 'react'
import { shadeConfig } from '../config/shadeConfig.js'
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

  const setScenario = (nextScenario) => {
    if (!shadeConfig.scenarios.includes(nextScenario)) {
      throw new RangeError(`不支持的 Shade 场景：${nextScenario}`)
    }
    setScenarioState(nextScenario)
  }
  const geoJSON = useMemo(
    () => state.status === 'ready'
      ? buildShadeFeatureCollection(graph, state.payload, scenario)
      : null,
    [graph, scenario, state.payload, state.status],
  )
  return {
    status: state.status,
    error: state.error,
    scenario,
    setScenario,
    geoJSON,
  }
}

