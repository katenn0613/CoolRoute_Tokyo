import { routePresentation } from '../config/presentationConfig.js'
import {
  formatDistance,
  formatExtraWalkingTime,
  formatPercent,
  formatScore,
  formatWalkingTime,
} from '../utils/formatters.js'

function tradeoffText(comparison) {
  const reduction = comparison?.modelledExposureLoadReductionPercent
  if (!Number.isFinite(reduction)) return '比較不可'
  if (reduction <= 0) return '最短ルートとの差を確認してください。'
  const extraTime = formatExtraWalkingTime((comparison.extraWalkingMinutes ?? 0) * 60)
    .replace(/^\+/, '')
  return `${extraTime}多く歩くことで、モデル上の累積暑さ曝露を${formatPercent(reduction)}低減`
}

export function RouteDetails({ mode, metrics, comparison }) {
  if (!metrics) return null
  const isFastest = mode === 'fastest'
  return (
    <section aria-labelledby="route-detail-title" className="route-detail">
      <div className="route-detail-heading">
        <p className="section-kicker">選択中のルート</p>
        <h3 id="route-detail-title">{routePresentation[mode].label}</h3>
      </div>
      <dl className="route-detail-metrics">
        <div><dt>所要時間</dt><dd>{formatWalkingTime(metrics.walkingTimeSeconds)}</dd></div>
        <div><dt>距離</dt><dd>{formatDistance(metrics.distanceMeters)}</dd></div>
        <div><dt>平均暑さ曝露スコア</dt><dd>{formatScore(metrics.averageHeatExposure)}</dd></div>
        <div>
          <dt>モデル上の累積暑さ曝露</dt>
          <dd>{Number.isFinite(metrics.modelledExposureLoad) ? metrics.modelledExposureLoad.toFixed(1) : '—'}</dd>
        </div>
        <div><dt>緑の多さ</dt><dd>{formatScore(metrics.greenIndicator)}</dd></div>
        <div><dt>給水スポットへのアクセス</dt><dd>{formatScore(metrics.waterAccessIndicator)}</dd></div>
      </dl>
      {!isFastest && (
        <div className="tradeoff-summary">
          <strong>{tradeoffText(comparison)}</strong>
          <span>
            平均暑さ曝露スコア{' '}
            {Number.isFinite(comparison?.averageHeatExposureReductionPercent)
              ? formatPercent(-comparison.averageHeatExposureReductionPercent, { signed: true })
              : '比較不可'}
          </span>
        </div>
      )}
    </section>
  )
}
