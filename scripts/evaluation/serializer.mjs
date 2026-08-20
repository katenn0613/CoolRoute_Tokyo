const ROUTE_LABELS = Object.freeze({
  fastest: '最短ルート',
  balanced: 'バランスルート',
  coolest: '涼しさ優先ルート',
})

export function normalizeForOutput(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('正式输出中的数值必须是有限数。')
    if (Object.is(value, -0)) return 0
    const normalized = Number(value.toFixed(12))
    return Object.is(normalized, -0) ? 0 : normalized
  }
  if (Array.isArray(value)) return value.map((item) => normalizeForOutput(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeForOutput(item)]),
    )
  }
  throw new TypeError(`正式输出不支持 ${typeof value}。`)
}

export function serializeJson(value) {
  return `${JSON.stringify(normalizeForOutput(value), null, 2)}\n`
}

function number(value, digits = 2) {
  if (value === null || value === undefined) return '比較不可'
  return Number(value).toFixed(digits)
}

function percentFromRate(value, digits = 1) {
  return value === null || value === undefined ? '比較不可' : `${number(value * 100, digits)}%`
}

function percentValue(value, digits = 1) {
  return value === null || value === undefined ? '比較不可' : `${number(value, digits)}%`
}

function routeMetricRows(summary) {
  return Object.entries(ROUTE_LABELS).map(([mode, label]) => {
    const metrics = summary.routeMetrics[mode]
    return `| ${label} | ${number(metrics.distanceMeters.mean, 1)} m | ${number(metrics.walkingTimeSeconds.mean / 60, 1)} 分 | ${number(metrics.averageHeatExposure.mean, 4)} | ${number(metrics.modelledExposureLoad.mean, 1)} | ${number(metrics.greenIndicator.mean, 4)} | ${number(metrics.waterAccessIndicator.mean, 4)} |`
  })
}

function comparisonRows(summary) {
  return ['balanced', 'coolest'].map((mode) => {
    const comparison = summary.comparisons[mode]
    return `| ${ROUTE_LABELS[mode]} | ${number(comparison.distributions.extraDistanceMeters.mean, 1)} m | ${number(comparison.distributions.extraWalkingMinutes.mean, 2)} 分 | ${number(comparison.distributions.averageHeatExposureReduction.mean, 4)} | ${percentValue(comparison.distributions.averageHeatExposureReductionPercent.mean)} | ${number(comparison.distributions.modelledExposureLoadReduction.mean, 1)} | ${percentValue(comparison.distributions.modelledExposureLoadReductionPercent.mean)} |`
  })
}

function improvementRows(summary) {
  return ['balanced', 'coolest'].map((mode) => {
    const improvements = summary.comparisons[mode].improvements
    return `| ${ROUTE_LABELS[mode]} | ${improvements.averageExposureReduced.count} (${percentFromRate(improvements.averageExposureReduced.rate)}) | ${improvements.loadReduced.count} (${percentFromRate(improvements.loadReduced.rate)}) | ${improvements.bothReduced.count} (${percentFromRate(improvements.bothReduced.rate)}) |`
  })
}

function thresholdRows(summary, mode, group) {
  return Object.values(summary.comparisons[mode].detourThresholds[group]).map((item) => {
    const suffix = group === 'extraDistancePercent' ? '%' : ' 分'
    return `| ${item.threshold}${suffix} 以下 | ${item.eligibleCount} (${percentFromRate(item.eligibleRateOfAllSamples)}) | ${item.averageExposureReducedCount} (${percentFromRate(item.averageExposureReducedRateWithinEligible)}) | ${item.loadReducedCount} (${percentFromRate(item.loadReducedRateWithinEligible)}) | ${item.bothReducedCount} (${percentFromRate(item.bothReducedRateWithinEligible)}) |`
  })
}

function thresholdSection(summary, mode) {
  return [
    `### ${ROUTE_LABELS[mode]}`,
    '',
    '距離増加率による集計：',
    '',
    '| 上限 | 対象 OD | 平均スコア低減 | 累積値低減 | 両方低減 |',
    '|---|---:|---:|---:|---:|',
    ...thresholdRows(summary, mode, 'extraDistancePercent'),
    '',
    '追加歩行時間による集計：',
    '',
    '| 上限 | 対象 OD | 平均スコア低減 | 累積値低減 | 両方低減 |',
    '|---|---:|---:|---:|---:|',
    ...thresholdRows(summary, mode, 'extraWalkingMinutes'),
  ].join('\n')
}

export function renderJapaneseSummary(summary) {
  const { samples, routeEquality, metadata } = summary
  const demoAreaName = metadata.demoArea?.name ?? metadata.demoArea?.id ?? '現在の Demo Area'
  return [
    '# CoolRoute Tokyo M7 ルート評価概要',
    '',
    '## 評価目的',
    '',
    `現在の Demo Area（${demoAreaName}）と現在のモデル条件において、追加歩行コストとモデル上の暑さ曝露の変化を、恣意的な Trade-off 選別なしで評価しました。`,
    '',
    '## 評価方法',
    '',
    `Random Seed \`${metadata.seed}\` を使用し、Production Road Graph 上で ${samples.totalCount} 組の有向 OD を抽出しました。Fastest Distance 別の内訳は 400–1000 m が ${samples.countsByStratum.short} 組、1000–2000 m が ${samples.countsByStratum.medium} 組、2000–3500 m が ${samples.countsByStratum.long} 組です。`,
    '',
    'すべての経路はブラウザで使用する正式な Routing 実装で計算しています。サンプルの採否には、経路の一致、暑さ曝露の改善、累積値の改善、追加距離の有利・不利を使用していません。',
    '',
    '## 経路の一致率',
    '',
    '| 比較 | 一致 OD | 割合 |',
    '|---|---:|---:|',
    `| 最短 = バランス | ${routeEquality.fastestEqualsBalanced.count} | ${percentFromRate(routeEquality.fastestEqualsBalanced.rate)} |`,
    `| 最短 = 涼しさ優先 | ${routeEquality.fastestEqualsCoolest.count} | ${percentFromRate(routeEquality.fastestEqualsCoolest.rate)} |`,
    `| 3 経路すべて一致 | ${routeEquality.allThreeEqual.count} | ${percentFromRate(routeEquality.allThreeEqual.rate)} |`,
    '',
    '## 経路指標の平均',
    '',
    '| 経路 | 距離 | 歩行時間 | 平均暑さ曝露スコア | モデル上の累積暑さ曝露 | Green Indicator | Water Access Indicator |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...routeMetricRows(summary),
    '',
    '## 最短ルートとの差',
    '',
    '| 経路 | 追加距離 | 追加時間 | 平均スコア低減 | 平均スコア低減率 | 累積値低減 | 累積値低減率 |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...comparisonRows(summary),
    '',
    '| 経路 | 平均暑さ曝露スコアが低下 | モデル上の累積暑さ曝露が低下 | 両方が低下 |',
    '|---|---:|---:|---:|',
    ...improvementRows(summary),
    '',
    '平均暑さ曝露スコアは距離加重平均です。モデル上の累積暑さ曝露は、Edge Length × Heat Exposure Score の合計であり、距離が増えると平均値が下がっても累積値が増える場合があります。',
    '',
    '## Detour Threshold 別集計',
    '',
    '特定の上限だけを「合理的」と決めず、複数の距離・時間上限を併記します。各低減率の分母は、その上限に入った OD 数です。',
    '',
    thresholdSection(summary, 'balanced'),
    '',
    thresholdSection(summary, 'coolest'),
    '',
    '## 解釈上の制約',
    '',
    '- 本結果は現在の Demo Area、現在の Production Graph、現在の Green/Water 代理指標、固定された Weight/Lambda、および 90 組の OD に限定されます。東京全域や異なる季節・時間帯への一般化はできません。',
    '- Green Indicator は道路周辺の公式な実緑被覆 Polygon に基づく代理値であり、樹冠の日陰や実測路面温度ではありません。',
    '- Water Access Indicator は最寄り公式 Drinking Station までの距離に基づく代理値であり、経路が給水地点を実際に通過することを示しません。',
    '- Heat Exposure Score と Modelled Exposure Load は経路比較のためのモデル指標です。医療リスクや熱中症確率を示すものではありません。',
    '',
    '## 再現性',
    '',
    `Evaluation Schema は \`${metadata.evaluationSchemaVersion}\`、Graph SHA-256 は \`${metadata.graphSha256}\` です。同一 Graph、Seed、Routing Config とコードから同一の正式出力を生成します。`,
    '',
  ].join('\n')
}
