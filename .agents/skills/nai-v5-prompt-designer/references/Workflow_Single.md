# ワークフロー：1ページ

対象：挿絵1枚、セリフ付き1枚絵、または1ページの漫画（2〜4コマ）。Text mode は `character_text`。縦スクロールWEBTOON連作は出さない。規則は [Rules.md](Rules.md)。出力形は [Output_Contract.md](Output_Contract.md)。

内部では Page（骨格名・読み順）→ Layout（階層英語とピン）→ Panel（画角・人物・行動）→ Appearance（出現単位の Character）→ Lettering（話者の「」）の順で組む。JSON/YAMLは出さない。骨格の階層英語は [Layout_Skeletons.md](Layout_Skeletons.md)。日本語のコマ割り文は Base に置かない（R-LAY-02）。

## 入力

小説抜粋・場面指示・キャラシート・添付画像。page_script（`page-handoff-v3`）があれば欄名で読む（パス参照しない）。v1／v2 は [Layout_Skeletons.md](Layout_Skeletons.md) の互換。**ページ** の骨格名 → Page、**配置** → Layout、**読める事実** → Panel（今の服と色・軸・体格差・見える結合）、**出現** → Appearance、**発話**の「」 → 通常フキダシの「」、**内心**の（） → 思考フキダシの「」、配置の話者なし → その Character に `speech bubble` / 「」なし。**原作** と発話割当はプロンプトへ出さない。外見固定があれば服の色と錨の正本。ピンは骨格表。重大な矛盾以外は仮置き（確認は最大3問）。指定なし：状態が変わる1転換＝挿絵1枚。指定が無ければ求められたページだけ。

illust_brief（`illust-handoff-v2`）があれば1枚絵として読む。**凍結** → 1時点、**配置** → Layout（コマに割らない）、**余白** → フキダシ用の空き、**動き** → 動作の途中（止まっているポーズだけにしない）、**表情** → 目口頬、**差分** → 行為1枚からの表情・動き・体液（精液タグだけに落とさない）、**読める事実** → Appearance／行為、**発話**の「」 → 通常フキダシ。`manga` / `comic panel` / `2koma` は置かない。場所が白地・簡略なら `simple background, white background`。ピンは挿絵既定。

page_script の日本語は事実の正本。プロンプトへは英語タグへ落とす。セリフだけ Character 末尾の「」に残す（R-TAG-02）。コマ説明の日本語はタグに残さない。

## 抜くもの

場所、時刻、光、人物（凍結キー）、状態、視点（誰の目か）、向き、視線の先、位置の軸、見える動作・体位・衣装、カメラ（視点と混ぜない）、セリフ、思考。地の文の心理、未描写の過去、視点人物が知らない情報は絵にしない。1コマに主要情報を複数詰め込まない。再生の声は `cellphone, phone screen` のカード。今の人物は別カード。Base の行為は今の場（R-LAY-06、R-LAY-07）。

セリフの抜き方は R-TXT。

## 英語タグとセリフ

切り分けの正本。R-TAG-02 はここを指す。

| 英語タグ | 日本語 |
|---|---|
| 人数、画風、`manga` / `comic` / `comic panel` / `2koma` と階層英語、場所、体位、カメラ、服と色、髪、目、露出、モザイク、行為、軸、画角 | なし。Base と Character のタグ欄に日本語を置かない |
| `speech bubble` / `thought bubble` / `japanese text` / `text` | 話者 Character 末尾の `「」` だけ（セリフ・思考の本文）。`text:` は書かない |

同じ概念を英語名と日本語名で並べない（R-TAG-12）。

視点の翻訳：

| 指示 | タグ例 |
|---|---|
| 見上げ／見下ろし（カメラ） | `from below` / `from above` |
| 横／後ろ／こちら | `from side` / `from behind` / `facing viewer` |
| 肩越し | `over shoulder`, `from behind` |
| 主観 | `pov` |
| 相手を見る | `looking at another` |
| 画面右／左（同一コマ。読者から見て） | `on the right` / `on the left` |

## Base の順

1. ケモノ時の dataset を繰り返さない（R-TAG-07）
2. `artist:` は今回の依頼が明示したときだけ先頭（R-STY-01）。前稿から引き継がない
3. 人数。続けて画風セット（挿絵は R-STY-01、漫画ページは R-STY-02）。画像内文字付きは審美を含める（R-TXT-03）
4. 漫画ページなら `manga, comic, comic panel` と骨格の koma タグと階層英語（[Layout_Skeletons.md](Layout_Skeletons.md)）。通常フキダシがあるページだけ `speech bubble, japanese text, text`。思考だけのページは `thought bubble, japanese text, text`。無言はどちらも置かない。`sound effects` は置かない。擬音を出すときだけ主カードに `sfx「」`（R-TXT-02、R-TXT-04、R-TXT-06）
5. 成人なら `nsfw, rating:explicit`（R-NSF-02）
6. 性器が見える画面は `mosaic censoring, censored`（R-NSF-01）
7. 漫画なら `-1.5::title ::, -1.5::caption ::`（R-TXT-10）
8. 場所・時間・天候（1系統。R-LAY-07）
9. 行為と位置関係（lexicon。R-TAG-13）。両手同時は1プレイ。再生の体勢は画面カードへ。Base には今の場だけ
10. 構図・カメラ
11. 必要なら年次、VNタグ

日本語のページ文・コマ文、YAML、JSON、`Comic page composition:` 見出しは置かない（R-LAY-02）。階層英語は骨格。位置はピン（R-LAY-04）。

## Character

`girl` / `boy` / `other`。凍結外見を毎回フル（R-TAG-01）。漫画ページでは出現単位（R-TAG-14）。続けて領域語（任意）・そのコマの衣装（色つき）・状態・視点・向き・視線・軸・体勢・手・カメラ。体格差は `size difference` と体型タグ（R-TAG-10）。接触は `source#` 1つ（R-TAG-04）。他カードの行為が混ざるときは、その行為語だけをこのカードで外す（R-TAG-05）。キャラクターの差し替えは上書きする。以前のキャラタグは残さない（R-TAG-15）。修正版では差し替え前の作品タグ・人物タグを削除する（R-TAG-16）。キャラクターイメージの指名は R-TAG-13。同一コマの二人目は画角タグ。左右が軸なら `on the right` / `on the left`（R-LAY-05）。

セリフがある話者だけ末尾。同一カードに2つなら `「A」 「B」`（R-TXT-01）。話者はフキダシの主であり、コマに別人がいても発話者の顔カードへ付ける（R-TXT-05）。

```text
speech bubble, open mouth, 「待って」
```

挿絵の会話例（Base は英語タグ。セリフは Character 末尾の「」）：

```text
1girl, 1boy, speech bubble, japanese text, text, living room, night, standing, looking at another, cowboy shot
```

Character 1：`girl, long black hair, brown eyes, white shirt, skirt, blush, angry, pointing, on the left, speech bubble, open mouth, 「帰って」`

Character 2：`boy, short brown hair, brown eyes, casual t-shirt, sweat, awkward smile, on the right`

前立腺＋手コキ（行為。カメラは `from side`。無言）：

```text
1girl, 1boy, nsfw, rating:explicit, mosaic censoring, censored, bedroom, night, sitting, handjob, from side, cowboy shot
```

Character 1：`girl, source#handjob, sitting`

Character 2：`boy, target#handjob, nude, huge penis, sitting`

射精は同じ手配置のまま `ejaculation`。受けが一人で床に出す絵にしない。

## ピン

挿絵：Character 1＝35, 50、2＝65, 50。前後があるなら y を 40 と 60。漫画ページは [Layout_Skeletons.md](Layout_Skeletons.md) のピン目安。2koma で y=50 に置かない。同一コマのツーショットはピンを同じ矩形内へ。人物のいないコマにピンを置かない（R-LAY-04、R-LAY-05）。ピン操作は [UI_Settings.md](UI_Settings.md)。

## 連続ページ

`## キャラ固定` は共有。髪・目・体型・服の色をページ間で変えない。服の種類が変わるときは脚本の今の服に従い、色は外見固定のまま。変わってよいのは表情、手足、着崩れ、光、セリフ。前ページの構図タグを惰性で再利用しない。体勢が同じなら軸は維持（R-LAY-06）。体格差のタグも維持する（R-TAG-10）。

## 情報源

ユーザー指定 → `work/character-sheet-*.md` → 小説本文 → 添付画像。矛盾したらユーザー指定が勝つ。添付はタグ化する（R-API-03）。
