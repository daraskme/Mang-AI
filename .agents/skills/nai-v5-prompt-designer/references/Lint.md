# UC・品質・Lint

規則の本文は [Rules.md](Rules.md)。ここはモジュール原文と、出す前の検査→ID。

## 品質ポリシー

| 政策 | いつ | Quality Tags | UC Preset | Base |
|---|---|---|---|---|
| `off_for_text` | 画像内文字あり | 指定なし | 指定なし | `very aesthetic, masterpiece`。`no text` を置かない |
| `ui_default` | 文字なし単体 | 標準 | 指定なし | 自動分を繰り返さない。`no text` は品質側に任せる |
| `custom` | ユーザー指定 | 指示どおり | 指示どおり | 指示どおり |

標準の自動付与（実測）：`very aesthetic, masterpiece, no text`。軽いの審美は `amazing quality`。標準・軽いとも `no text` を含む。画像内文字付きは指定なし（R-TXT-03）。

## UCプリセット（実測。漫画既定は指定なし＋自前UC）

人間に重点を置く:

```text
lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy
```

強い: 上から `@_@, mismatched pupils, glowing eyes, bad anatomy` を除いたもの。

UC の軽い:

```text
lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated
```

`0::ai-generated` の意図はテスターにも未解明。Quality Tags の「軽い」と UC Preset の「軽い」は別コントロール。ケモノモードのV5本文は未確認。確度は [NAI_V5_Current_Spec.md](NAI_V5_Current_Spec.md)。

## 挿絵既定 UC

```text
photorealistic, realistic, photo, 3d, western comic, sketch, painterly, cel shading, flat color, watercolor (medium), monochrome, greyscale, bad anatomy, bad hands, extra fingers, missing fingers, jpeg artifacts, logo, watermark, signature, chibi, extra faces, floating head
```

画像内文字付きは足す：`distorted text, unreadable text, cropped speech bubble, furigana`

## 漫画既定 UC

挿絵既定 UC と同じ原文。文字付きは足す：`distorted text, unreadable text, cropped speech bubble, furigana`

性行為コマは R-NSF-02。入れない語は R-API-05。

## モジュール（必要なとき足す）

- anatomy：`bad anatomy, bad hands, extra fingers, missing fingers`
- artifact：`jpeg artifacts, scan artifacts`
- unwanted_text：`logo, watermark, signature`（文字なしなら `text` も）
- realism：`photorealistic, realistic, photo, 3d`
- style：狙わない画風。Medium はユーザーが画材を出したときだけ
- 負の数値強調：Base か Character へ `-1::hat ::`（UCとは別）

文字なし人物でプリセットを使うなら 人間に重点を置く。漫画既定にはしない。

## 検査（出す前）

### 文字

| 検査 | ID |
|---|---|
| 画像内文字あり ＋ `no text` / UC の `text` | R-TXT-03 |
| セリフが話者 Character 末尾の「」でない。同じ行に `text:`。Base に「」または日本語文 | R-TXT-01, R-TAG-02 |
| Base に手動 `Text:`。2つ目のセリフで `Text:` を繰り返している | R-TXT-01 |
| 無言カードに `speech bubble` / 「」。無言ページの Base に `speech bubble` | R-TXT-02 |
| Base に既定で `sound effects`。`sfx「」` 以外の日本語擬音。擬音をセリフの「」や `Text:` に入れている | R-TXT-06 |
| 思考なのに `speech bubble`、または思考本文に「」が無い | R-TXT-04 |
| 1コマのフキダシが3以上 | R-TXT-04 |
| 同一ページに通常と思考 | R-TXT-04 |
| しっぽ位置の日本語。コマ説明の人名で話者を決めている | R-TXT-05 |
| 文字なし指定なのにフキダシ／`text:`／「」 | R-TXT-07 |
| 顔の無いカードに `speech bubble` / 「」 | R-TXT-09 |
| 漫画なのに `-1.5::title ::` が無い | R-TXT-10 |

### 画面

| 検査 | ID |
|---|---|
| 縦スクロールWEBTOON連作を出している | R-LAY-01 |
| 漫画ページなのに `2koma`/`3koma`/`4koma`、階層英語、またはピン表が無い。Base に日本語のコマ割り文／YAML／JSON。`3koma` だけで等分ピン | R-LAY-02, R-LAY-03 |
| 配置のピンが重なっている | R-LAY-04 |
| Base人数とユニーク人数が食い違う | R-LAY-05 |
| Character 内の `1girl` | R-TAG-01 |
| 使わない Character を無効のまま残す。出現より多いカード。余った小コマに立ち絵 | R-LAY-05, Output_Contract |
| 脚だけ・手元だけの端役にカード | R-LAY-05 |
| 同一コマの二人目に画角タグが無い。ツーショットなのにピンが別コマ。左右が軸なのに `on the right` / `on the left` が無い | R-LAY-05 |
| 人物のいないコマにピンがある | R-LAY-04 |
| 同一体勢で軸逆転／1コマに2時点。再生と今が同一コマ | R-LAY-06 |
| 浴室と夜の庭など場所が2つ。Base に再生の体勢 | R-LAY-07 |
| 小サイズで漫画ページを出している | R-LAY-08 |

### 画風・タグ

| 検査 | ID |
|---|---|
| 今回の依頼が明示していないのに Base に `artist:` がある。挿絵なのに画風セットが無い | R-STY-01 |
| 漫画ページの Base に `crisp lineart` / `cel shading` / `clear color separation` / `high contrast`。R-STY-01 の画風セットが無い。挿絵の Base に `crisp lineart` / `cel shading` | R-STY-02 |
| `traditional media` / `marker (medium)` が既定のまま | R-STY-03 |
| 実写語 | R-STY-04 |
| `::` の閉じ忘れ | R-TAG-06 |
| UI Character ＋ `\|` / `(tag)` | R-TAG-06 |
| 反対体位の打ち消しが全 Character / 同一欄に二回 | R-TAG-05 |
| 核の髪・目・体型・服の色がカード間で欠けている。同一人物の全カードが looking at viewer | R-TAG-01, R-TAG-11 |
| 同じ服なのに色タグがページで違う | R-TAG-01 |
| 識別小物が複数 Character | R-TAG-09 |
| 指定された体型を落とした／毎回の `adult`／ちびで小柄を代用 | R-TAG-10 |
| 「」以外の日本語。英語タグ＋日本語名の同一概念 | R-TAG-12, R-TAG-02 |
| `handjob, anal fingering` を体位2系統として落とした | R-TAG-04 |
| 挿入の組み方が2系統 | R-TAG-13 |
| 明示した `artist:` を落とした／前稿・カタログから補った。V4.5 Artist Mix・512上限・英語ASCII強制 | R-TAG-08, R-STY-05 |

### NSFW・API

| 検査 | ID |
|---|---|
| 竿・結合・性器タグがあるのに mosaic が無い / Base に `uncensored` | R-NSF-01 |
| 画像内文字付きなのに Quality Tags 標準／軽い、Base に masterpiece が無い | R-TXT-03 |
| 透過トグルとタグの二重 | R-API-02 |
| ケモノなのに Base の `fur dataset` | R-TAG-07 |
| ステップ>28 または大サイズを既定 | R-API-01 |
| 挿絵UCまたは漫画UCに `text` / `comic` / `multiple views` / `negative space` / `blank page`。画像内文字付きなのに `furigana` が無い | R-API-05 |

安全の拒否は SKILL.md「安全」。Lint しない。

## うまくいかないとき

1. seed 固定、1変数だけ変える
2. 該当タグを前方へ
3. 数値強調 1.2 → 1.5 → 2.0
4. 負の数値強調
5. UCモジュール追加
6. 短い最小構成へ戻す
7. 文字が出ない：Quality Tags 指定なし、話者 Character に `speech bubble` と「」（R-TXT-01, R-TXT-03）。短い文字は [NAI_V5_Current_Spec.md](NAI_V5_Current_Spec.md) §3 の `no text`
8. フキダシが別人：「」を話者の顔カードへ。口元の日本語を消す（R-TXT-05, R-TXT-09）
9. フキダシに英語：タグ行の `text:` をやめ、「」だけにする。ドライランで `Text:` が日本語のみか見る（R-TXT-01）
10. コマにならない／数が違う／等分の縦3：骨格の階層英語とピンを [Layout_Skeletons.md](Layout_Skeletons.md) どおりにする。日本語のコマ割り文・YAMLを足さない（R-LAY-02、R-LAY-04）
11. 縦4コマが 2×2 になる：階層英語の `not a two-by-two grid`、縦長、ピンの y（R-LAY-03）
12. 前立腺が抱きつき／単独射精：`from side`、両手の位置、`source#handjob`
13. 顔が安定しない：固定行を守る。核は `1.2::tag ::`。インペイントまたは i2i
14. 背景が白い：場所タグを前へ。`-1::simple background ::`
15. bleed：配置を離す、当該 Character UC
16. 空フキダシ／文字化け／挿入顔：R-TXT-02、R-TXT-04、R-TXT-06、R-LAY-05
17. 4コマ同じ立ち絵：カードを出現どおり。画角を分ける（R-LAY-05、R-TAG-11）
17b. 隣接コマが同じ立ち絵：同一人物のカードに動作差またはカメラ差があるか（R-TAG-11）
18. 再生が生身：`cellphone, phone screen`。今は別カード（R-LAY-06、R-LAY-07）
