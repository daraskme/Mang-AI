# 漫画ページの骨格（V5）

`page-handoff-v3` の骨格名を、Base の階層英語とピンへ落とす正本。脚本は日本語名だけ書く。x,y と英語は本ファイル。挿絵のピンは [UI_Settings.md](UI_Settings.md)。規則は R-LAY-02〜04。**原作** 欄は使わない。

推奨方法（2026-09 community）：コマ数タグだけにしない。**ページ→段→列→入れ子**の英語を `2koma` / `3koma` / `4koma` の直後に置き、位置はピン。YAML・JSON・日本語のコマ割り文は置かない。`Comic page composition:` のような見出しも Base に置かない（Output_Contract）。

## 手順

1. page_script の **ページ** から骨格名を取る。v1 の別名は下の互換。
2. 下表の **koma** と **階層英語** を Base の `manga, comic, comic panel` の直後へ、カンマ区切りで1行にする。
3. Character に領域語（`upper-left panel` 等）を付けてよい。日本語の「上のコマ」は書かない（R-TAG-14）。
4. ピンは対象コマ矩形の中央。表の目安。同一コマの二人目は同じ矩形内で 15 以上離す。人物のいないコマにピンを置かない。
5. 隣接ページの骨格が同じなら、脚本側の未完成（Q-PR-02）。プロンプト側で別名に勝手に差し替えない。
6. カード数は人がいるコマだけ。空の `4koma` は残コマをクローンする。2×2 は同一人物・同一画角を4つ置かない。立ち絵のインセットが脚本に無ければカードを足さない（R-LAY-05、R-TAG-11）。
7. 隣接コマが同じツーショット立ち絵（同じ画角・`looking at another`・動作なし）だと、領域語（`top panel` / `bottom panel`）だけではクローンする。縦3（中大）の上下、上大＋下2の左右下段が典型。コマごとに動作またはカメラを変える。

等分の縦3段（`3koma` のみ、ピン y=16/50/83）は出さない。

## カタログ

| 骨格名 | コマ | 読み順 | koma | いつ |
|---|---|---|---|---|
| 縦2（上大） | 2 | 上から下 | `2koma` | 見せ場が上。受け・オチが下 |
| 縦2（下大） | 2 | 上から下 | `2koma` | 溜めが上。見せ場が下 |
| 上横長＋右下大＋左下インセット | 3 | 上→右下→左下 | `3koma` | 場所出し、告白、オチ顔 |
| 上大＋下2 | 3 | 上→右下→左下 | `3koma` | 手順3拍。同一話者の3連 |
| 2×2（下段大小） | 4 | 右上→左上→右下→左下 | `4koma` | 4ビート。下段にアクションと反応 |
| 左2＋右縦長＋下横長 | 4 | 左上→左中→右縦長→下 | `4koma` | 右を見せ場。左は溜め。下は着地 |
| 2×2 | 4 | 右上→左上→右下→左下 | `4koma` | 会話の切り返し。大小が無いので連続させない。同一人物の同じ画角4連には使わない |
| 縦3（中大） | 3 | 上から下 | `3koma` | 3拍で中が核のときだけ。等分にしない |
| 縦4 | 4 | 最上段→最下段 | `4koma` | 落下・追走だけ。2×2に潰れやすい |

## 階層英語（原文。削らない）

**縦2（上大）**

```text
2koma, two rows, the top row occupies about two thirds of the page height, the bottom row is one smaller panel
```

**縦2（下大）**

```text
2koma, two rows, the top row is one smaller panel, the bottom row occupies about two thirds of the page height
```

**上横長＋右下大＋左下インセット**

```text
3koma, two rows, the top row is one wide horizontal panel spanning the full page width, the bottom row is split into a larger right panel and a smaller left inset panel
```

**上大＋下2**

```text
3koma, two rows, the top row occupies about half the page height as one wide panel, the bottom row has two equal panels
```

**2×2（下段大小）**

```text
4koma, two rows, narrow gutter, top row has two equal panels, bottom row has one wide action panel and one smaller final reaction panel
```

**左2＋右縦長＋下横長**

```text
4koma, narrow gutter, the upper row occupies about two thirds of the page height and is split into a narrow left column and a wider right column, the left column contains two stacked rectangular panels, the upper-right panel is one tall vertical rectangle spanning the full height of the upper row, the bottom row contains one wide horizontal panel spanning the full page width
```

**2×2**

```text
4koma, two rows, two columns, four equal rectangular panels
```

**縦3（中大）**

```text
3koma, three rows, the middle row is a wide action panel, the top and bottom rows are smaller
```

**縦4**

```text
4koma, four stacked rectangular panels, top to bottom, not a two-by-two grid
```

Base 例（画風のあとに続ける）：

```text
1girl, 1boy, anime illustration, official art, soft shading, clean lineart, high complexity, depthness, very aesthetic, masterpiece, manga, comic, comic panel, 3koma, two rows, the top row is one wide horizontal panel spanning the full page width, the bottom row is split into a larger right panel and a smaller left inset panel, speech bubble, japanese text, text, cafe, indoors, -1.5::title ::, -1.5::caption ::
```

## ピン目安（主。副は 15 以上離す）

| 骨格名 | ピン |
|---|---|
| 縦2（上大） | 上 50, 32 ／ 下 50, 82 |
| 縦2（下大） | 上 50, 18 ／ 下 50, 68 |
| 上横長＋右下大＋左下インセット | 上横長に人がいなければピンなし。右下大 70,68 と 88,68（同一矩形）。左下インセット 22,82。上横長に人がいるときだけ 50,14 |
| 上大＋下2 | 上 50, 28 ／ 右下 75, 78 ／ 左下 25, 78 |
| 2×2（下段大小） | 右上 75, 22 ／ 左上 25, 22 ／ 下段の大 62, 75 ／ 下段の小 22, 78 |
| 左2＋右縦長＋下横長 | 左上 22, 22 ／ 左中 22, 48 ／ 右縦長 72, 35 ／ 下横長 50, 85 |
| 2×2 | 右上 75, 25 ／ 左上 25, 25 ／ 右下 75, 75 ／ 左下 25, 75 |
| 縦3（中大） | 上 50, 12 ／ 中 50, 48 ／ 下 50, 88 |
| 縦4 | 50,12 ／ 50,37 ／ 50,62 ／ 50,88 |

領域語：`top panel` / `bottom panel` / `upper-left panel` / `upper-right panel` / `middle-left panel` / `lower-left panel` / `lower-right panel` / `inset panel` / `wide bottom panel`。

## 互換（page-handoff-v1／v2）

v2／v3 の骨格名はそのまま使う。v1 の別名：

| 旧 | 読む骨格 |
|---|---|
| 縦2 ／ 縦2コマ | 配置が「上半分」なら 縦2（上大）。「下半分」が広い指定なら 縦2（下大）。無指定は 縦2（上大） |
| 縦3 ／ 縦3コマ | 縦3（中大）。等分ピンにしない |
| 横長導入＋右下大＋左下インセット | 上横長＋右下大＋左下インセット |
| 2×2 | 下段に大小の指定があれば 2×2（下段大小）。無ければ 2×2 |
| 縦4 | 縦4 |
