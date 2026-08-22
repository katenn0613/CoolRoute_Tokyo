import { shadeConfig } from '../config/shadeConfig.js'

export function MapLayerControls({
  heatVisible,
  drinkingVisible,
  shadeVisible,
  shadeStatus,
  shadeScenario,
  onHeatChange,
  onDrinkingChange,
  onShadeChange,
  onShadeScenarioChange,
}) {
  const shadeReady = shadeStatus === 'ready'
  return (
    <div className="map-layer-controls" aria-label="地図レイヤー">
      <strong>地図表示</strong>
      <label>
        <input checked={heatVisible} onChange={(event) => onHeatChange(event.target.checked)} type="checkbox" />
        暑さ曝露レイヤー
      </label>
      <label>
        <input
          checked={shadeVisible}
          disabled={!shadeReady}
          onChange={(event) => onShadeChange(event.target.checked)}
          type="checkbox"
        />
        {shadeConfig.layerLabel}
      </label>
      <label className="scenario-row">
        {shadeConfig.scenarioLabel}
        <select
          aria-label={shadeConfig.scenarioLabel}
          disabled={!shadeReady}
          onChange={(event) => onShadeScenarioChange(event.target.value)}
          value={shadeScenario}
        >
          {shadeConfig.scenarios.map((scenario) => (
            <option key={scenario} value={scenario}>{scenario}</option>
          ))}
        </select>
      </label>
      <small className="scenario-note">この時刻の日陰条件を経路計算に反映</small>
      {shadeStatus === 'error' && <small role="status">日陰データを利用できません</small>}
      <label>
        <input checked={drinkingVisible} onChange={(event) => onDrinkingChange(event.target.checked)} type="checkbox" />
        給水スポット
      </label>
    </div>
  )
}
