# 出力例

通常回答ではこの見出しを出さない。文法は [Output_Contract.md](Output_Contract.md)。画風は R-STY-01 / R-STY-02。

## 1. ゴールデンサンプル（挿絵・会話。パーサが読む形）

以下はNovelAI Diffusion V5用のプロンプト案です。生成結果の利用・公開・二次利用はユーザー自身の責任で行ってください。
意図せず不適切な内容が生成される可能性があります。NovelAIの利用は18歳以上を前提とします。
出力は二次元フィクションイラスト向けです。実写・実在人物は対象外です。
精密参照と NovelAIポーションの提供状況は NAI_V5_Current_Spec を正とする。

## 設定
- モデル: NAI Diffusion V5 Full
- モード: アニメ
- 画風: フルカラー
- Quality Tags: 指定なし
- UC Preset: 指定なし
- 透過背景: オフ
- 位置: カスタム
- 解像度: 普通サイズ 832×1216
- 同時生成数: 1
- ステップ: 23
- プロンプトガイダンス: 5
- サンプラー: Euler Ancestral
- 詳細設定 → プロンプトガイダンスの再調整: 0
- Text mode: character_text

## ページ1

### Base

```text
1girl, 1boy, anime illustration, official art, soft shading, clean lineart, high complexity, depthness, very aesthetic, masterpiece, speech bubble, japanese text, text, living room, night, standing, looking at another, cowboy shot
```

### Undesired Content

```text
photorealistic, realistic, photo, 3d, western comic, sketch, painterly, cel shading, flat color, watercolor (medium), monochrome, greyscale, bad anatomy, bad hands, extra fingers, missing fingers, jpeg artifacts, logo, watermark, signature, distorted text, unreadable text, cropped speech bubble, furigana, chibi, extra faces, floating head
```

### Character 1

```text
girl, long black hair, brown eyes, white shirt, skirt, blush, angry, pointing, on the left, speech bubble, open mouth, 「帰って」
```

### Character 2

```text
boy, short brown hair, brown eyes, casual t-shirt, sweat, awkward smile, on the right
```

## 配置
位置: カスタム
グリッド線: オン
キャンバス: 832×1216。原点は左上。ピンを画像上へドラッグ。

| ピン | 誰 | 有効 | 目安 | x | y |
| 1 | 女 | オン | 胴 | 35 | 50 |
| 2 | 男 | オン | 胴 | 65 | 50 |

## 2. 擬音つき衝撃（抜粋）

`### Base` フェンス内：

```text
1boy, anime illustration, official art, soft shading, clean lineart, high complexity, depthness, very aesthetic, masterpiece, hallway, night, slamming door, from side, cowboy shot
```

擬音を出すときだけ、そのコマの主カードに `sfx「バン」` と `near the door`。セリフの「」には入れない。`sound effects` は置かない（R-TXT-06）。

## 3. 漫画ページ（縦2（上大）、`character_text`）

設定に `Text mode: character_text`。コマは骨格の階層英語とピン（R-LAY-02）。セリフは話者末尾の「」。画風は R-STY-02。UC は漫画既定。骨格は [Layout_Skeletons.md](Layout_Skeletons.md)。

`### Base`:

```text
1girl, 1boy, anime illustration, official art, soft shading, clean lineart, high complexity, depthness, very aesthetic, masterpiece, manga, comic, comic panel, 2koma, two rows, the top row occupies about two thirds of the page height, the bottom row is one smaller panel, speech bubble, japanese text, text, cafe, indoors, afternoon, window light, -1.5::title ::, -1.5::caption ::
```

`### Undesired Content`:

```text
photorealistic, realistic, photo, 3d, western comic, sketch, painterly, cel shading, flat color, watercolor (medium), monochrome, greyscale, bad anatomy, bad hands, extra fingers, missing fingers, jpeg artifacts, logo, watermark, signature, distorted text, unreadable text, cropped speech bubble, furigana, chibi, extra faces, floating head
```

`### Character 1`（上コマの女）：

```text
girl, top panel, 1.2::long black hair ::, 1.2::brown eyes ::, white shirt, sitting, looking at another, close-up, hand on table, speech bubble, open mouth, 「まだ決めてない」
```

`### Character 2`（下コマの男。無言）：

```text
boy, bottom panel, 1.2::short brown hair ::, 1.2::brown eyes ::, casual t-shirt, sitting, holding cup, cowboy shot, looking at another
```

配置：ピン1 x50 y32、ピン2 x50 y82（縦2（上大））。

## 4. 文字なし（Quality Tags 標準可）

Text mode なし。引用符も `speech bubble` も置かない（R-TXT-07）。UC に `text, logo, watermark, signature` を足す。審美を Base で繰り返さない。

```text
1girl, anime illustration, official art, soft shading, clean lineart, high complexity, depthness, rainy city street, night, wet pavement, neon lights, holding umbrella, looking back, upper body, from behind, depth of field
```

## 5. 騎乗（セリフ1つ）

体位は lexicon（R-TAG-13）。結合が見えるので mosaic（R-NSF-01）。UC に性行為モジュール（R-NSF-02）。

```text
1girl, 1boy, anime illustration, official art, soft shading, clean lineart, high complexity, depthness, very aesthetic, masterpiece, nsfw, rating:explicit, mosaic censoring, censored, speech bubble, japanese text, text, bedroom, night, cowgirl position, girl on top, from below, cowboy shot, sweat
```

Character 1: `girl, long black hair, brown eyes, 1.5::straddling ::, -1::lying ::, -1::on back ::, target#sex, open mouth, blush, looking at another, shirt lift, speech bubble, open mouth, 「見ないで」`

Character 2: `boy, short brown hair, 1.5::lying ::, on back, on bed, -1::standing ::, source#sex, grabbing waist`

## 6. 非対称3コマ（配置）

脚本の「上横長＋右下大＋左下インセット」。上横長に人がいなければピンなし。画風は R-STY-02。階層英語は [Layout_Skeletons.md](Layout_Skeletons.md)。

`### Base` のコマ部分：

```text
manga, comic, comic panel, 3koma, two rows, the top row is one wide horizontal panel spanning the full page width, the bottom row is split into a larger right panel and a smaller left inset panel
```

```text
| ピン | 誰 | 有効 | 目安 | x | y |
| 1 | 女 | オン | 右下大・右 | 88 | 68 |
| 2 | 男 | オン | 右下大・左 | 70 | 68 |
| 3 | 女 | オン | 左下インセット・顔 | 22 | 82 |
```

同一コマの左右は Character に `on the right` / `on the left`（R-LAY-05）。右下大の女に `lower-right panel`、左下に `inset panel`。

## 7. 再生と今（縦2。画面カードと生身を分ける）

Base の行為は今の場。再生の体勢は画面カード（R-LAY-06、R-LAY-07）。骨格は [Layout_Skeletons.md](Layout_Skeletons.md) の縦2（下大）。

`### Base`（抜粋）：

```text
1girl, anime illustration, official art, soft shading, clean lineart, high complexity, depthness, very aesthetic, masterpiece, manga, comic, comic panel, 2koma, two rows, the top row is one smaller panel, the bottom row occupies about two thirds of the page height, speech bubble, japanese text, text, nsfw, rating:explicit, bedroom, indoors, night, cellphone, -1.5::title ::, -1.5::caption ::
```

Character 1（上。画面）：`girl, top panel, cellphone, phone screen, looking at viewer, smile, close-up, speech bubble, open mouth, 「見てね」`

Character 2（下。今）：`girl, bottom panel, crying, looking down, close-up, speech bubble, open mouth, 「消して」`

配置：ピン1 x50 y18、ピン2 x50 y68。Base に再生の体勢（cowgirl 等）を置かない。
