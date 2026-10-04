# カラー漫画の画風タグ調査（artist 以外）

調査日 2026-09-19。対象は `artist:` 以外。運用の既定は [Rules.md](Rules.md) R-STY。**このファイルは調査アーカイブであり、既定を変えない。** 画風パックを検討するときだけ読む。

情報源の優先順と確度は [NAI_V5_Current_Spec.md](NAI_V5_Current_Spec.md) と同じ。

## 採用（2026-09-19）

現状維持。挿絵は R-STY-01、漫画ページは R-STY-02。

```text
anime illustration, official art, soft shading, clean lineart, high complexity, depthness
```

文字付きは続けて `very aesthetic, masterpiece`。Quality Tags は指定なし。`cel shading` は漫画 UC のまま。

## 公式（official_v5）

カラー漫画専用の画風パックは無い。公式の漫画節はレイアウト（自然言語かピンで1ページを一度に出す）であり、塗りや線の指定ではない。公式X（2026-09-19）も画風タグを書いていない。

画風に近い公式タグ:

| タグ | 公式の位置づけ | カラー漫画 |
|---|---|---|
| `high complexity` | 普通に整った絵の既定。ultra/low は様式化 | 既定に入れてよい |
| `depthness` | 陰影に奥行き | 柔らかい塗りと相性がよい |
| `visual novel art` 等 | VN風 | 漫画の標準にしない |
| `meta:golden era` / `meta:novel era` | やや現代 / やや古め | 任意。必須ではない |
| Quality Tags 標準 | `very aesthetic, masterpiece, no text` | 文字付きはトグルOFF。審美だけ手動 |
| `no text` | 品質トグルに含まれる | 吹き出し漫画では外す |

一次情報:

- https://blognew.novelai.net/novelai-diffusion-v5-release-jp-343211a45664/
- https://journal.novelai.net/image-generation-novelai-diffusion-v5-is-here-c2df7c6b8d2d/
- https://docs.novelai.net/en/image/qualitytags/
- https://docs.novelai.net/en/image/textrendering/

## コミュニティの二系統（community）

### A. 柔らかい公式イラスト寄り

現行 R-STY と同じ方向。テスター 公開テスター（シトラス）note 2026-08-21、X 2026-08-20〜24。

よく使う組み合わせ:

```text
high complexity, anime style illustration, anime coloring, year 2026
```

彩度: 正 `anime coloring`。負 `realistic`, `muted colors`（作例 `-2::realistic::`, `-0.8::muted colors::`）。

線: `thick lineart` / `very thick lineart`（任意）。`ligne claire` は明瞭な輪郭＋フラット色。背景をイラストに寄せる実験用。

複雑度: `high` が標準。`low` はノーラインに近いフラット。`ultra` は様式化（品質タグ過強調でキラキラしすぎるという報告）。

### B. セル塗り・境界くっきり漫画寄り

公開作例A:

```text
year 2025, full color, color manga page, clean lineart, cel shading
```

公開作例B:

```text
crisp lineart, defined outlines, thick outlines,
vivid colors, high contrast, clear color separation,
cel shading, sharp shading, modern anime style
```

ネガ側の要点: `gradient shading, soft lighting, soft glow, flat color, monochrome`。

狙いは小さいコマでも輪郭と色面が残る現代アニメ漫画。`soft shading` と併記しない。R-STY-02 と UC がこの系統を拒否している。

### その他（標準にしない）

| タグ | 報告 | 扱い |
|---|---|---|
| `official art` | 公式イラストの構図・ポーズ・服・ライティングまで寄せる | 現行に既にある。版権タグ直後だと効きが強い |
| `official style` | 絵柄だけ公式に寄せる。作品タグ直後で二次創作混在を減らす | 版権固定用。オリジナル既定にはしない |
| `comic` | 線が濃く主張する | レイアウト用。線が太すぎるときだけ疑う |
| `sequential` | コマ枠なしの連作 | WEBTOON連作は本Skill対象外 |
| `visual novel art` | 公式VN風 | 漫画ページを立ち絵CGに寄せる |

## 現行との対応

| 項目 | 現行 R-STY | 公式 | 系統A | 系統B |
|---|---|---|---|---|
| `high complexity` | あり | 推奨 | あり | 記事により省略 |
| `depthness` | あり | 公式新規 | 必須ではない | なし |
| `official art` | あり | 未言及 | あまり使わない | なし |
| `soft shading` | あり | 未言及 | あまり使わない | ネガ側 |
| `clean lineart` | あり | 未言及 | `lineart` / 太線 | `clean` または `crisp` |
| `anime coloring` | なし | 未言及 | 常用 | なし |
| `year 2026` | なし | 年次は継承 | 常用 | 別の公開作例は `year 2025` |
| `cel shading` | UCで除外 | 未言及 | 使わない | 中核 |
| `color manga page` | なし | 未言及 | なし | 公開作例あり |

足してもよいが未採用: `year 2026`, `anime coloring`。系統Bへ切替えるときは `soft shading` を外し、UCから `cel shading` を外す。中間（両方併記）は避ける。


