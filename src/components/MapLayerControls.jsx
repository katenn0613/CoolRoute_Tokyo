export function MapLayerControls({ heatVisible, drinkingVisible, onHeatChange, onDrinkingChange }) {
  return (
    <div className="map-layer-controls" aria-label="地図レイヤー">
      <strong>地図表示</strong>
      <label>
        <input checked={heatVisible} onChange={(event) => onHeatChange(event.target.checked)} type="checkbox" />
        暑さ曝露レイヤー
      </label>
      <label>
        <input checked={drinkingVisible} onChange={(event) => onDrinkingChange(event.target.checked)} type="checkbox" />
        給水スポット
      </label>
    </div>
  )
}
