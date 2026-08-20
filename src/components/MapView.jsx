import { useEffect, useRef, useState } from 'react'
import { Map, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { demoArea } from '../config/demoArea.js'
import { mapStyle } from '../config/mapStyle.js'
import {
  exposureLayerPresentation,
  getRouteSampleStyle,
  routePresentation,
  shadeLayerPresentation,
} from '../config/presentationConfig.js'
import { assetPath } from '../utils/assetPath.js'
import { MapLayerControls } from './MapLayerControls.jsx'

const routeModes = ['fastest', 'balanced', 'coolest']
const emptyGeoJSON = { type: 'FeatureCollection', features: [] }

function routeData(routes, mode) {
  return routes?.[mode]?.geoJSON ?? emptyGeoJSON
}

function routeLayer(mode) {
  const presentation = routePresentation[mode]
  const paint = {
    'line-color': presentation.color,
    'line-width': presentation.backgroundWidth,
    'line-opacity': presentation.backgroundOpacity,
  }
  if (presentation.dasharray) paint['line-dasharray'] = presentation.dasharray
  return {
    id: `route-${mode}-line`,
    type: 'line',
    source: `route-${mode}`,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint,
  }
}

export function MapView({
  destination = null,
  exposureGeoJSON = null,
  interactionEnabled = false,
  onMapClick = () => {},
  routes = null,
  selectedMode = 'balanced',
  shadeGeoJSON = null,
  shadeScenario = '12:00',
  shadeStatus = 'idle',
  onShadeScenarioChange = () => {},
  start = null,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const startMarkerRef = useRef(null)
  const destinationMarkerRef = useRef(null)
  const onMapClickRef = useRef(onMapClick)
  const interactionEnabledRef = useRef(interactionEnabled)
  const routesRef = useRef(routes)
  const selectedModeRef = useRef(selectedMode)
  const exposureRef = useRef(exposureGeoJSON)
  const shadeRef = useRef(shadeGeoJSON)
  const [status, setStatus] = useState('loading')
  const [mapReady, setMapReady] = useState(false)
  const [heatVisible, setHeatVisible] = useState(false)
  const [drinkingVisible, setDrinkingVisible] = useState(false)
  const [shadeVisible, setShadeVisible] = useState(false)

  onMapClickRef.current = onMapClick
  interactionEnabledRef.current = interactionEnabled
  routesRef.current = routes
  selectedModeRef.current = selectedMode
  exposureRef.current = exposureGeoJSON
  shadeRef.current = shadeGeoJSON

  useEffect(() => {
    setWorkerUrl(workerUrl)
    const map = new Map({
      container: containerRef.current,
      style: mapStyle,
      center: demoArea.center,
      zoom: demoArea.zoom,
      maxBounds: demoArea.boundingBox,
      attributionControl: true,
    })
    mapRef.current = map
    map.addControl(new NavigationControl(), 'top-right')
    map.on('load', () => {
      map.addSource('heat-exposure', {
        type: 'geojson',
        data: exposureRef.current ?? emptyGeoJSON,
      })
      map.addLayer({
        id: 'heat-exposure-line',
        type: 'line',
        source: 'heat-exposure',
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': exposureLayerPresentation.width,
          'line-opacity': exposureLayerPresentation.opacity,
          'line-color': [
            'interpolate', ['linear'], ['get', 'heatExposure'],
            0, exposureLayerPresentation.lowColor,
            0.7, exposureLayerPresentation.middleColor,
            1, exposureLayerPresentation.highColor,
          ],
        },
      })
      map.addSource('building-shade', {
        type: 'geojson',
        data: shadeRef.current ?? emptyGeoJSON,
      })
      map.addLayer({
        id: 'building-shade-line',
        type: 'line',
        source: 'building-shade',
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': shadeLayerPresentation.color,
          'line-width': shadeLayerPresentation.width,
          'line-opacity': [
            'interpolate', ['linear'], ['get', 'shadeScore'],
            0, shadeLayerPresentation.minimumOpacity,
            1, shadeLayerPresentation.maximumOpacity,
          ],
        },
      })
      map.addSource('drinking-stations', {
        type: 'geojson',
        data: assetPath('data/drinking_stations.geojson'),
      })
      map.addLayer({
        id: 'drinking-stations-points',
        type: 'circle',
        source: 'drinking-stations',
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': 6,
          'circle-color': '#0b7285',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })
      for (const mode of routeModes) {
        map.addSource(`route-${mode}`, { type: 'geojson', data: routeData(routesRef.current, mode) })
        map.addLayer(routeLayer(mode))
      }
      const selectedPresentation = routePresentation[selectedModeRef.current]
      map.addSource('route-selected', {
        type: 'geojson',
        data: routeData(routesRef.current, selectedModeRef.current),
      })
      map.addLayer({
        id: 'route-selected-line',
        type: 'line',
        source: 'route-selected',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': selectedPresentation.color,
          'line-width': selectedPresentation.selectedWidth,
          'line-opacity': selectedPresentation.selectedOpacity,
          ...(selectedPresentation.dasharray
            ? { 'line-dasharray': selectedPresentation.dasharray }
            : {}),
        },
      })
      setStatus('ready')
      setMapReady(true)
    })
    map.on('click', (event) => {
      if (!interactionEnabledRef.current) return
      onMapClickRef.current([event.lngLat.lng, event.lngLat.lat])
    })
    map.on('error', () => {
      setStatus((currentStatus) => (currentStatus === 'ready' ? currentStatus : 'error'))
    })
    return () => {
      startMarkerRef.current?.remove()
      destinationMarkerRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!start) {
      startMarkerRef.current?.remove()
      startMarkerRef.current = null
      return
    }
    if (!startMarkerRef.current) startMarkerRef.current = new Marker({ color: '#13795b' })
    startMarkerRef.current.setLngLat([start.node.lon, start.node.lat]).addTo(map)
  }, [start])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!destination) {
      destinationMarkerRef.current?.remove()
      destinationMarkerRef.current = null
      return
    }
    if (!destinationMarkerRef.current) destinationMarkerRef.current = new Marker({ color: '#c2413b' })
    destinationMarkerRef.current.setLngLat([destination.node.lon, destination.node.lat]).addTo(map)
  }, [destination])

  useEffect(() => {
    if (!mapReady) return
    for (const mode of routeModes) {
      mapRef.current?.getSource(`route-${mode}`)?.setData(routeData(routes, mode))
    }
  }, [mapReady, routes])

  useEffect(() => {
    if (!mapReady) return
    const presentation = routePresentation[selectedMode]
    mapRef.current?.getSource('route-selected')?.setData(routeData(routes, selectedMode))
    mapRef.current?.setPaintProperty('route-selected-line', 'line-color', presentation.color)
    mapRef.current?.setPaintProperty('route-selected-line', 'line-width', presentation.selectedWidth)
    mapRef.current?.setPaintProperty(
      'route-selected-line', 'line-dasharray', presentation.dasharray ?? null,
    )
  }, [mapReady, routes, selectedMode])

  useEffect(() => {
    if (!mapReady) return
    mapRef.current?.getSource('heat-exposure')?.setData(exposureGeoJSON ?? emptyGeoJSON)
  }, [exposureGeoJSON, mapReady])

  useEffect(() => {
    if (!mapReady) return
    mapRef.current?.getSource('building-shade')?.setData(shadeGeoJSON ?? emptyGeoJSON)
  }, [mapReady, shadeGeoJSON])

  useEffect(() => {
    if (!mapReady) return
    mapRef.current?.setLayoutProperty(
      'heat-exposure-line', 'visibility', heatVisible ? 'visible' : 'none',
    )
  }, [heatVisible, mapReady])

  useEffect(() => {
    if (!mapReady) return
    mapRef.current?.setLayoutProperty(
      'building-shade-line',
      'visibility',
      shadeVisible && shadeStatus === 'ready' ? 'visible' : 'none',
    )
  }, [mapReady, shadeStatus, shadeVisible])

  useEffect(() => {
    if (!mapReady) return
    mapRef.current?.setLayoutProperty(
      'drinking-stations-points', 'visibility', drinkingVisible ? 'visible' : 'none',
    )
  }, [drinkingVisible, mapReady])

  return (
    <section
      aria-label="対象エリアのルート地図"
      className={`map-shell${interactionEnabled ? ' map-interactive' : ''}`}
    >
      <div className="map-canvas" ref={containerRef} />
      <div aria-live="polite" className={`map-status map-status-${status}`}>
        {status === 'loading' && '地図を読み込んでいます…'}
        {status === 'ready' && '地図を操作できます'}
        {status === 'error' && <span role="alert">地図を読み込めませんでした。</span>}
      </div>
      <MapLayerControls
        drinkingVisible={drinkingVisible}
        heatVisible={heatVisible}
        onDrinkingChange={setDrinkingVisible}
        onHeatChange={setHeatVisible}
        onShadeChange={setShadeVisible}
        onShadeScenarioChange={onShadeScenarioChange}
        shadeScenario={shadeScenario}
        shadeStatus={shadeStatus}
        shadeVisible={shadeVisible}
      />
      <div className="map-legend" aria-label="ルート凡例">
        {routeModes.map((mode) => (
          <span key={mode}>
            <i
              className="legend-line"
              style={getRouteSampleStyle(routePresentation[mode], 'legend')}
            />
            {routePresentation[mode].shortLabel}
          </span>
        ))}
        {heatVisible && (
          <span className="heat-legend"><b>低い</b><i /><b>高い</b></span>
        )}
        {shadeVisible && shadeStatus === 'ready' && (
          <span><i className="shade-legend-line" />推定日陰 {shadeScenario}</span>
        )}
      </div>
      <div className="map-area-caption">
        <span>対象エリア</span>
        <strong>皇居東側・丸の内・東京駅周辺</strong>
      </div>
    </section>
  )
}
