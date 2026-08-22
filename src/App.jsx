import { useState } from 'react'
import { MapView } from './components/MapView.jsx'
import { ProductInfo } from './components/ProductInfo.jsx'
import { RouteControls } from './components/RouteControls.jsx'
import { PHASES } from './routing/selectionMachine.js'
import { useRouteBundle } from './routing/useRouteBundle.js'

export default function App() {
  const routingState = useRouteBundle()
  const [sheetExpanded, setSheetExpanded] = useState(true)
  const interactionEnabled = routingState.graphStatus === 'ready'
    && routingState.phase !== PHASES.ROUTE_READY
    && !routingState.isCalculating

  return (
    <main className="app-shell">
      <aside className={`control-panel${sheetExpanded ? ' sheet-expanded' : ' sheet-collapsed'}`}>
        <header className="brand-header">
          <div className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" focusable="false">
              <path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7" />
            </svg>
          </div>
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
          <p className="area-label"><span>対象エリア</span><strong>東京23区</strong></p>

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
        shadeGeoJSON={routingState.shadeGeoJSON}
        shadeScenario={routingState.shadeScenario}
        shadeStatus={routingState.shadeStatus}
        onShadeScenarioChange={routingState.changeShadeScenario}
        start={routingState.start}
      />
    </main>
  )
}
