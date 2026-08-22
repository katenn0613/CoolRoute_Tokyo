import { PHASES } from '../routing/selectionMachine.js'
import { RouteCard } from './RouteCard.jsx'
import { RouteDetails } from './RouteDetails.jsx'

const routeModes = ['fastest', 'balanced', 'coolest']

function pointStatus(selection) {
  return selection ? '選択済み' : '未選択'
}

export function RouteControls({ routingState }) {
  const {
    destination,
    error,
    graphStatus,
    metrics,
    routes,
    comparisons,
    routingEnvironmentStatus,
    shadeCoverage,
    selectedMode = 'balanced',
    phase,
    prompt,
    recalculate,
    reset,
    selectDestination,
    selectStart,
    selectMode = () => {},
    start,
    isCalculating = false,
  } = routingState
  const hasCompleteRoute = Boolean(start && destination && metrics)
  const routeReady = hasCompleteRoute && phase === PHASES.ROUTE_READY

  return (
    <section aria-labelledby="route-controls-title" className="route-planner">
      <div className="section-heading">
        <p className="section-kicker">ルートを比較</p>
        <h2 id="route-controls-title">出発地と目的地</h2>
      </div>

      <div className="location-summary">
        <div><span className="marker-dot marker-dot-start" /><span>出発地</span><strong>{pointStatus(start)}</strong></div>
        <div><span className="marker-dot marker-dot-destination" /><span>目的地</span><strong>{pointStatus(destination)}</strong></div>
      </div>

      <p aria-live="polite" className="selection-prompt">{prompt}</p>
      {error && <p className="routing-error" role="alert">{error}</p>}
      {routingEnvironmentStatus === 'base-only' && (
        <p className="routing-error" role="status">
          日陰データを利用できないため、緑・給水のみで計算しています
        </p>
      )}

      <fieldset className="route-cards" disabled={isCalculating}>
        <legend>比較するルート</legend>
        {routeModes.map((mode) => (
          <RouteCard
            key={mode}
            mode={mode}
            onSelect={selectMode}
            route={routes?.[mode] ?? null}
            selected={selectedMode === mode}
          />
        ))}
      </fieldset>

      <RouteDetails
        comparison={selectedMode === 'fastest' ? null : comparisons?.[selectedMode]}
        metrics={metrics}
        mode={selectedMode}
      />

      <button
        className="primary-action"
        disabled={!routeReady || graphStatus !== 'ready' || isCalculating}
        onClick={recalculate}
        type="button"
      >
        ルートを再計算
      </button>
      <div className="route-actions">
        <button disabled={!routeReady} onClick={selectStart} type="button">出発地を変更</button>
        <button disabled={!routeReady} onClick={selectDestination} type="button">目的地を変更</button>
        <button onClick={reset} type="button">リセット</button>
      </div>
      <p className="feature-note">
        平均暑さ曝露スコアは低いほど、現在のモデルで推定される曝露が少ないことを示します。
        涼しさ優先ルートは、距離とのバランスを保ちながら低いモデル値をより重視します。
      </p>
    </section>
  )
}
