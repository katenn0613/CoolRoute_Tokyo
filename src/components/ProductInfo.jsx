export function ProductInfo() {
  return (
    <section className="product-info" aria-label="プロジェクト情報">
      <details>
        <summary>使用データ</summary>
        <ul>
          <li>
            <a href="https://www.openstreetmap.org/" rel="noreferrer" target="_blank">
              OpenStreetMap
            </a>
          </li>
          <li>
            <a href="https://www.geospatial.jp/ckan/dataset/plateau-tokyo23ku" rel="noreferrer" target="_blank">
              国土交通省 Project PLATEAU 建築物モデル
            </a>
          </li>
          <li>
            <a
              href="https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d2000000024"
              rel="noreferrer"
              target="_blank"
            >
              東京都「緑のオープンデータ（GISデータ）」
            </a>
          </li>
          <li>
            <a
              href="https://catalog.data.metro.tokyo.lg.jp/dataset/t000019d0000000003"
              rel="noreferrer"
              target="_blank"
            >
              東京都水道局「Tokyowater Drinking Station」
            </a>
          </li>
        </ul>
      </details>
      <details>
        <summary>計算方法</summary>
        <p>
          CoolRoute Tokyo は、道路距離、緑地データ、給水スポットへの近さを用いて
          Project PLATEAU から秋分日の建物日陰を離線推定し、緑・給水による指標を75%、
          建物日陰を25%の環境要因として組み合わせます。09:00、12:00、15:00 の
          日陰条件と徒歩距離のバランスを考慮してルートを探索します。
        </p>
        <p className="disclaimer">
          本サービスの「暑さ曝露スコア」は、公開データをもとにしたモデル上の環境指標であり、
          熱中症の発症確率や医学的リスクを予測するものではありません。
          実際の環境や通行状況はモデルと異なる場合があります。
        </p>
      </details>
    </section>
  )
}
