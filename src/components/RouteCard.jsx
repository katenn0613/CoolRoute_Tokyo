import { getRouteSampleStyle, routePresentation } from '../config/presentationConfig.js'
import { formatDistance, formatScore, formatWalkingTime } from '../utils/formatters.js'

export function RouteCard({ mode, route, selected, onSelect }) {
  const presentation = routePresentation[mode]
  const metrics = route?.metrics ?? null
  return (
    <label className={`route-card${selected ? ' route-card-selected' : ''}`}>
      <input
        aria-label={presentation.label}
        checked={selected}
        name="route-mode"
        onChange={() => onSelect(mode)}
        type="radio"
        value={mode}
      />
      <span
        aria-hidden="true"
        className="route-swatch"
        style={getRouteSampleStyle(presentation, 'card')}
      />
      <span className="route-card-content">
        <span className="route-card-heading">
          <strong>{presentation.label}</strong>
          {selected && <small>選択中</small>}
        </span>
        {metrics ? (
          <span className="route-card-metrics">
            <span><small>所要時間</small><b>{formatWalkingTime(metrics.walkingTimeSeconds)}</b></span>
            <span><small>距離</small><b>{formatDistance(metrics.distanceMeters)}</b></span>
            <span><small>平均暑さ曝露スコア</small><b>{formatScore(metrics.averageHeatExposure)}</b></span>
          </span>
        ) : (
          <small className="route-card-empty">地点を選択すると比較できます</small>
        )}
      </span>
    </label>
  )
}
