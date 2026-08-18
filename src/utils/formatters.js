const COMPARISON_UNAVAILABLE = '比較不可'

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

export function formatDistance(distanceMeters) {
  if (!finiteNumber(distanceMeters) || distanceMeters < 0) return '—'
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`
  const kilometers = distanceMeters / 1000
  return `${kilometers.toFixed(kilometers >= 10 ? 1 : 2).replace(/\.0+$|(?<=\.[0-9])0$/, '')} km`
}

export function formatWalkingTime(seconds) {
  if (!finiteNumber(seconds) || seconds < 0) return '—'
  return `${Math.ceil(seconds / 60)}分`
}

export function formatExtraWalkingTime(seconds) {
  if (!finiteNumber(seconds)) return COMPARISON_UNAVAILABLE
  const sign = seconds < 0 ? '−' : '+'
  const absoluteSeconds = Math.abs(seconds)
  if (absoluteSeconds < 60) return `${sign}${Math.round(absoluteSeconds)}秒`
  return `${sign}${Math.ceil(absoluteSeconds / 60)}分`
}

export function formatScore(value) {
  return finiteNumber(value) ? value.toFixed(2) : '—'
}

export function formatPercent(value, { signed = false } = {}) {
  if (!finiteNumber(value)) return COMPARISON_UNAVAILABLE
  const rounded = Math.round(Math.abs(value))
  if (!signed) return `${Math.round(value)}%`
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${rounded}%`
}
