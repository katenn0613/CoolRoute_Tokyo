import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { demoArea } from '../../src/config/demoArea.js'
import { routePresentation } from '../../src/config/presentationConfig.js'
import { MapView } from '../../src/components/MapView.jsx'

const maplibre = vi.hoisted(() => ({
  handlers: {}, sources: new Map(), addControl: vi.fn(), addLayer: vi.fn(),
  addSource: vi.fn(), getSource: vi.fn(), setLayoutProperty: vi.fn(),
  setPaintProperty: vi.fn(), mapConstructor: vi.fn(), markerInstances: [],
  remove: vi.fn(), setWorkerUrl: vi.fn(),
}))

vi.mock('maplibre-gl', () => ({
  Map: class {
    constructor(options) {
      maplibre.mapConstructor(options)
      return {
        addControl: maplibre.addControl, addLayer: maplibre.addLayer,
        addSource: maplibre.addSource, getSource: maplibre.getSource,
        setLayoutProperty: maplibre.setLayoutProperty,
        setPaintProperty: maplibre.setPaintProperty,
        on: vi.fn((event, handler) => { maplibre.handlers[event] = handler }),
        remove: maplibre.remove,
      }
    }
  },
  Marker: class {
    constructor(options) {
      const marker = {
        options, setLngLat: vi.fn().mockReturnThis(),
        addTo: vi.fn().mockReturnThis(), remove: vi.fn(),
      }
      maplibre.markerInstances.push(marker)
      return marker
    }
  },
  NavigationControl: class {},
  setWorkerUrl: maplibre.setWorkerUrl,
}))

vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({
  default: './assets/maplibre-worker.js',
}))

const geoJSON = (name) => ({
  type: 'Feature', properties: { name },
  geometry: { type: 'LineString', coordinates: [[139.75, 35.68], [139.751, 35.681]] },
})

const routes = {
  fastest: { geoJSON: geoJSON('fastest') },
  balanced: { geoJSON: geoJSON('balanced') },
  coolest: { geoJSON: geoJSON('coolest') },
}

describe('M6 MapView', () => {
  beforeEach(() => {
    maplibre.handlers = {}
    maplibre.sources = new Map()
    for (const mock of [
      maplibre.addControl, maplibre.addLayer, maplibre.addSource, maplibre.getSource,
      maplibre.setLayoutProperty, maplibre.setPaintProperty, maplibre.mapConstructor,
      maplibre.remove, maplibre.setWorkerUrl,
    ]) mock.mockReset()
    maplibre.markerInstances = []
    maplibre.addSource.mockImplementation((id) => {
      maplibre.sources.set(id, { setData: vi.fn() })
    })
    maplibre.getSource.mockImplementation((id) => maplibre.sources.get(id))
  })

  it('按固定 Z-order 添加环境层、三条背景路线和 Selected 顶层', () => {
    render(<MapView exposureGeoJSON={{ type: 'FeatureCollection', features: [] }} routes={routes} />)
    act(() => maplibre.handlers.load())

    expect(maplibre.addLayer.mock.calls.map(([layer]) => layer.id)).toEqual([
      'heat-exposure-line',
      'building-shade-line',
      'drinking-stations-points',
      'route-fastest-line',
      'route-balanced-line',
      'route-coolest-line',
      'route-selected-line',
    ])
    expect(maplibre.addLayer.mock.calls[0][0].layout.visibility).toBe('none')
    expect(maplibre.addLayer.mock.calls[1][0].layout.visibility).toBe('none')
    expect(maplibre.addLayer.mock.calls[6][0].paint['line-width']).toBeGreaterThan(
      maplibre.addLayer.mock.calls[5][0].paint['line-width'],
    )
    expect(maplibre.addLayer.mock.calls[6][0].paint['line-opacity'])
      .toBe(routePresentation.balanced.selectedOpacity)
    expect(maplibre.addLayer.mock.calls[3][0].paint).not.toHaveProperty('line-dasharray')
    expect(maplibre.addLayer.mock.calls[4][0].paint['line-dasharray'])
      .not.toEqual(maplibre.addLayer.mock.calls[5][0].paint['line-dasharray'])
  })

  it('更新三条真实路线，并让当前选择控制最高层而不修改 geometry', () => {
    const { rerender } = render(<MapView routes={routes} selectedMode="balanced" />)
    act(() => maplibre.handlers.load())

    expect(maplibre.sources.get('route-fastest').setData).toHaveBeenCalledWith(routes.fastest.geoJSON)
    expect(maplibre.sources.get('route-balanced').setData).toHaveBeenCalledWith(routes.balanced.geoJSON)
    expect(maplibre.sources.get('route-coolest').setData).toHaveBeenCalledWith(routes.coolest.geoJSON)
    expect(maplibre.sources.get('route-selected').setData).toHaveBeenCalledWith(routes.balanced.geoJSON)

    rerender(<MapView routes={routes} selectedMode="coolest" />)
    expect(maplibre.sources.get('route-selected').setData).toHaveBeenLastCalledWith(routes.coolest.geoJSON)
    expect(maplibre.setPaintProperty).toHaveBeenCalledWith(
      'route-selected-line', 'line-color', routePresentation.coolest.color,
    )
  })

  it('Heat 和 Drinking 图层默认关闭并可由日语控件打开', () => {
    const onShadeScenarioChange = vi.fn()
    render(
      <MapView
        onShadeScenarioChange={onShadeScenarioChange}
        shadeScenario="12:00"
        shadeStatus="ready"
      />,
    )
    act(() => maplibre.handlers.load())

    expect(screen.getByLabelText('暑さ曝露レイヤー')).not.toBeChecked()
    expect(screen.getByLabelText('建物による推定日陰')).not.toBeChecked()
    expect(screen.getByLabelText('給水スポット')).not.toBeChecked()
    fireEvent.click(screen.getByLabelText('暑さ曝露レイヤー'))
    fireEvent.click(screen.getByLabelText('建物による推定日陰'))
    fireEvent.click(screen.getByLabelText('給水スポット'))
    fireEvent.change(screen.getByLabelText('日陰条件'), { target: { value: '15:00' } })
    expect(maplibre.setLayoutProperty).toHaveBeenCalledWith('heat-exposure-line', 'visibility', 'visible')
    expect(maplibre.setLayoutProperty).toHaveBeenCalledWith('building-shade-line', 'visibility', 'visible')
    expect(maplibre.setLayoutProperty).toHaveBeenCalledWith('drinking-stations-points', 'visibility', 'visible')
    expect(onShadeScenarioChange).toHaveBeenCalledWith('15:00')
    expect(screen.getByText('低い')).toBeInTheDocument()
    expect(screen.getByText('高い')).toBeInTheDocument()
  })

  it('Shade 加载失败时禁用控件但不隐藏现有地图状态', () => {
    render(<MapView shadeStatus="error" />)
    act(() => maplibre.handlers.load())

    expect(screen.getByLabelText('建物による推定日陰')).toBeDisabled()
    expect(screen.getByLabelText('日陰条件')).toBeDisabled()
    expect(screen.getByText('日陰データを利用できません')).toBeInTheDocument()
    expect(screen.getByText('地図を操作できます')).toBeInTheDocument()
  })

  it('保留地图点击、日语状态和 Marker DOM Overlay', () => {
    const onMapClick = vi.fn()
    render(
      <MapView
        destination={{ node: { lon: 139.753, lat: 35.682 } }}
        interactionEnabled
        onMapClick={onMapClick}
        start={{ node: { lon: 139.75, lat: 35.68 } }}
      />,
    )
    expect(screen.getByText('地図を読み込んでいます…')).toBeInTheDocument()
    expect(maplibre.mapConstructor).toHaveBeenCalledWith(expect.objectContaining({
      center: demoArea.center, zoom: demoArea.zoom, maxBounds: demoArea.boundingBox,
    }))

    act(() => maplibre.handlers.load())
    act(() => maplibre.handlers.click({ lngLat: { lng: 139.76, lat: 35.68 } }))

    expect(screen.getByText('地図を操作できます')).toBeInTheDocument()
    expect(onMapClick).toHaveBeenCalledWith([139.76, 35.68])
    expect(maplibre.markerInstances).toHaveLength(2)
    expect(maplibre.markerInstances[0].setLngLat).toHaveBeenCalledWith([139.75, 35.68])
    expect(maplibre.markerInstances[1].setLngLat).toHaveBeenCalledWith([139.753, 35.682])
  })

  it('错误时隐藏技术详情并在卸载时移除 Map', () => {
    const { unmount } = render(<MapView />)
    act(() => maplibre.handlers.error(new Error('tile secret')))
    expect(screen.getByRole('alert')).toHaveTextContent('地図を読み込めませんでした。')
    expect(screen.queryByText('tile secret')).not.toBeInTheDocument()
    unmount()
    expect(maplibre.remove).toHaveBeenCalledOnce()
  })
})
