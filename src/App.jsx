import { useState } from 'react'
import { MapView } from './components/MapView.jsx'
import { ProductInfo } from './components/ProductInfo.jsx'
import { RouteControls } from './components/RouteControls.jsx'
import { PHASES } from './routing/selectionMachine.js'
import { useRouteBundle } from './routing/useRouteBundle.js'
import { useShadeLayer } from './shade/useShadeLayer.js'

export default function App() {
  const routingState = useRouteBundle()
  const shadeState = useShadeLayer({ graph: routingState.roadGraph })
  const [sheetExpanded, setSheetExpanded] = useState(true)
  const interactionEnabled = routingState.graphStatus === 'ready'
    && routingState.phase !== PHASES.ROUTE_READY
    && !routingState.isCalculating

  return (
    <main className="app-shell">
      <aside className={`control-panel${sheetExpanded ? ' sheet-expanded' : ' sheet-collapsed'}`}>
        <header className="brand-header">
          <div className="brand-mark" aria-hidden="true">CR</div>
          <div>
            <h1>CoolRoute Tokyo</h1>
            <p className="brand-tagline">暑い日の徒歩移動を、もっと快適に。</p>
          </div>
        </header>
        <button
          aria-controls="route-panel-content"
          aria-expanded={sheetExpanded}
          className="sheet-toggle"
          onClick={() => setSheetExpanded((current) => !current)}
          type="button"
        >
          {sheetExpanded ? 'ルートパネルを閉じる' : 'ルートパネルを開く'}
        </button>
        <div id="route-panel-content" className="panel-content">
          <p className="hero-copy">
            最短ルートと、緑や給水スポットを考慮したルートを比較します。
          </p>
          <p className="area-label"><span>対象エリア</span><strong>皇居東側・丸の内・東京駅周辺</strong></p>

          <RouteControls routingState={routingState} />
          <ProductInfo />
        </div>
      </aside>

      <MapView
        destination={routingState.destination}
        exposureGeoJSON={routingState.exposureGeoJSON}
        interactionEnabled={interactionEnabled}
        onMapClick={routingState.handleMapClick}
        routes={routingState.routes}
        selectedMode={routingState.selectedMode}
        shadeGeoJSON={shadeState.geoJSON}
        shadeScenario={shadeState.scenario}
        shadeStatus={shadeState.status}
        onShadeScenarioChange={shadeState.setScenario}
        start={routingState.start}
      />
    </main>
  )
}
