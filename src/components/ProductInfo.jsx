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
          道路ごとのモデル上の暑さ曝露指標を計算し、徒歩距離とのバランスを考慮して
          ルートを探索します。
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
