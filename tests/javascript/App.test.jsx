import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App.jsx'

const mapViewMock = vi.hoisted(() => ({ props: null }))
vi.mock('../../src/components/MapView.jsx', () => ({
  MapView: (props) => { mapViewMock.props = props; return null },
}))

const routingHook = vi.hoisted(() => ({ state: {} }))
vi.mock('../../src/routing/useRouteBundle.js', () => ({
  useRouteBundle: () => routingHook.state,
}))

const shadeHook = vi.hoisted(() => ({ args: null }))
vi.mock('../../src/shade/useShadeLayer.js', () => ({
  useShadeLayer: (args) => {
    shadeHook.args = args
    return {
      status: 'ready', error: null, scenario: '12:00',
      setScenario: vi.fn(), geoJSON: { type: 'FeatureCollection', features: [] },
    }
  },
}))

function metrics(distance = 1000, exposure = 0.6) {
  return {
    distanceMeters: distance,
    walkingTimeSeconds: distance / 1.4,
    edgeCount: 4,
    averageHeatExposure: exposure,
    modelledExposureLoad: distance * exposure,
    greenIndicator: 0.35,
    waterAccessIndicator: 0.7,
  }
}

function routingState(overrides = {}) {
  return {
    phase: 'awaiting-start', graphStatus: 'ready', graphLoadTimeMs: 10,
    start: null, destination: null, route: null, routeGeoJSON: null,
    metrics: null, error: null, prompt: '地図上で出発地を選択してください',
    handleMapClick: vi.fn(), selectStart: vi.fn(), selectDestination: vi.fn(),
    reset: vi.fn(), recalculate: vi.fn(), selectMode: vi.fn(),
    selectedMode: 'balanced', routes: null, comparisons: null,
    roadGraph: null, isCalculating: false,
    ...overrides,
  }
}

function readyState(overrides = {}) {
  const routes = {
    fastest: { metrics: metrics(1000, 0.6), geoJSON: { type: 'Feature' } },
    balanced: { metrics: metrics(1040, 0.55), geoJSON: { type: 'Feature' } },
    coolest: { metrics: metrics(1120, 0.48), geoJSON: { type: 'Feature' } },
  }
  return routingState({
    phase: 'route-ready', prompt: '3つのルートを比較できます',
    start: { node: { id: 'a', lon: 139.75, lat: 35.68 } },
    destination: { node: { id: 'd', lon: 139.753, lat: 35.682 } },
    routes, metrics: routes.balanced.metrics,
    comparisons: {
      balanced: {
        extraWalkingMinutes: 0.48,
        averageHeatExposureReductionPercent: 5,
        modelledExposureLoadReductionPercent: 8,
      },
      coolest: {
        extraWalkingMinutes: 1.42,
        averageHeatExposureReductionPercent: 20,
        modelledExposureLoadReductionPercent: 10,
      },
    },
    ...overrides,
  })
}

describe('M6 日语正式产品页面', () => {
  beforeEach(() => { routingHook.state = routingState() })

  it('将 Road Graph 交给独立 Shade Hook 并传入地图，不改变路线状态', () => {
    const roadGraph = { metadata: { graphVersion: '1.1.0' }, edges: new Map() }
    routingHook.state = routingState({ roadGraph })

    render(<App />)

    expect(shadeHook.args.graph).toBe(roadGraph)
    expect(mapViewMock.props.shadeStatus).toBe('ready')
    expect(mapViewMock.props.shadeScenario).toBe('12:00')
    expect(routingHook.state.recalculate).not.toHaveBeenCalled()
  })

  it('首屏用日语解释产品并引导选择出发地', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'CoolRoute Tokyo' })).toBeInTheDocument()
    expect(screen.getByText('暑い日の徒歩移動を、もっと快適に。')).toBeInTheDocument()
    expect(screen.getByText('地図上で出発地を選択してください')).toBeInTheDocument()
    expect(screen.getByLabelText('最短ルート')).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'バランスルート' })).toBeChecked()
    expect(screen.getByLabelText('涼しさ優先ルート')).toBeEnabled()
    expect(screen.getByRole('button', { name: '出発地を変更' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '目的地を変更' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'リセット' })).toBeEnabled()
  }, 15000)

  it('三条 Route Card 显示日语指标，切换只调用 selectMode', () => {
    routingHook.state = readyState()
    render(<App />)

    expect(screen.getAllByText('平均暑さ曝露スコア')).toHaveLength(4)
    expect(screen.getAllByText('1.04 km')).toHaveLength(2)
    fireEvent.click(screen.getByLabelText('涼しさ優先ルート'))
    expect(routingHook.state.selectMode).toHaveBeenCalledWith('coolest')
    expect(routingHook.state.recalculate).not.toHaveBeenCalled()
  })

  it('Trade-off 严格区分累积 Load 与平均 Score 百分比', () => {
    routingHook.state = readyState()
    render(<App />)
    expect(screen.getByText(/モデル上の累積暑さ曝露を8%低減/)).toBeInTheDocument()
    expect(screen.getByText('平均暑さ曝露スコア −5%')).toBeInTheDocument()
  })

  it('不可计算的百分比显示比較不可', () => {
    routingHook.state = readyState({
      comparisons: {
        balanced: {
          extraWalkingMinutes: 0,
          averageHeatExposureReductionPercent: null,
          modelledExposureLoadReductionPercent: null,
        },
      },
    })
    render(<App />)
    expect(screen.getAllByText('比較不可').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(/NaN%|Infinity%/)).not.toBeInTheDocument()
  })

  it('使用数据与计算方法替代开发 Data Status', () => {
    render(<App />)
    expect(screen.getByText('使用データ')).toBeInTheDocument()
    expect(screen.getByText('計算方法')).toBeInTheDocument()
    expect(screen.getByText(/緑のオープンデータ（GISデータ）/)).toBeInTheDocument()
    expect(screen.getByText(/熱中症の発症確率や医学的リスクを予測するものではありません/)).toBeInTheDocument()
    expect(screen.queryByText('Data Status')).not.toBeInTheDocument()
    expect(screen.queryByText('Ready')).not.toBeInTheDocument()
  })

  it('Mobile Bottom Sheet 可折叠且不清除路线状态', () => {
    routingHook.state = readyState()
    render(<App />)
    const toggle = screen.getByRole('button', { name: 'ルートパネルを閉じる' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'ルートパネルを開く' }))
      .toHaveAttribute('aria-expanded', 'false')
    expect(routingHook.state.reset).not.toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: 'バランスルート' })).toBeChecked()
  })
})
