export const routePresentation = Object.freeze({
  fastest: Object.freeze({
    label: '最短ルート',
    shortLabel: '最短',
    color: '#1769aa',
    dasharray: null,
    backgroundWidth: 4,
    backgroundOpacity: 0.48,
    selectedWidth: 8,
    selectedOpacity: 0.96,
    sampleDash: null,
    sampleWidth: Object.freeze({ card: 26, legend: 24 }),
  }),
  balanced: Object.freeze({
    label: 'バランスルート',
    shortLabel: 'バランス',
    color: '#d97706',
    dasharray: Object.freeze([2, 1.5]),
    backgroundWidth: 4.5,
    backgroundOpacity: 0.5,
    selectedWidth: 8.5,
    selectedOpacity: 0.96,
    sampleDash: Object.freeze({ dash: 6, gap: 4 }),
    sampleWidth: Object.freeze({ card: 26, legend: 24 }),
  }),
  coolest: Object.freeze({
    label: '涼しさ優先ルート',
    shortLabel: '涼しさ優先',
    color: '#6d4cc7',
    dasharray: Object.freeze([4, 2]),
    backgroundWidth: 5,
    backgroundOpacity: 0.5,
    selectedWidth: 9,
    selectedOpacity: 0.96,
    sampleDash: Object.freeze({ dash: 14, gap: 7 }),
    sampleWidth: Object.freeze({ card: 26, legend: 24 }),
  }),
})

export function getRouteSampleStyle(presentation, variant) {
  const width = presentation.sampleWidth[variant]
  const style = {
    width: `${width}px`,
    height: `${presentation.backgroundWidth}px`,
    backgroundColor: presentation.color,
  }
  if (!presentation.sampleDash) return style
  const { dash, gap } = presentation.sampleDash
  return {
    ...style,
    backgroundColor: 'transparent',
    backgroundImage: `repeating-linear-gradient(to right, ${presentation.color} 0 ${dash}px, transparent ${dash}px ${dash + gap}px)`,
  }
}

export const exposureLayerPresentation = Object.freeze({
  opacity: 0.38,
  width: 2.25,
  lowColor: '#2a9d8f',
  middleColor: '#f4a261',
  highColor: '#c44536',
})
