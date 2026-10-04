# 規則カタログ

`contract: output-v1` と対。**各 ID の本文はここだけ。** 他ファイルは ID を書く。安全・拒否は SKILL.md「安全」（ここへ移さない）。

## 文字 R-TXT

- **R-TXT-01** Text mode は `character_text`。フキダシ本文は話者 Character の末尾に `「」` だけ。同じ行に `text:` と書かない（`speech bubble, open mouth, text:…` だと `speech bubble` 等の英語が描き文字になる）。同一カードに2つなら `「A」 「B」`。既存の「」を消して `speech bubble` を重ねない。スクリプトが「」を抜いて Character 末尾へ `Text:` を付ける。2つ目以降は `Text:` を繰り返さない（フキダシ先頭に T / 1 が描かれる）。ドライランで `Text:` が日本語のみか、タグ行に「」が残っていないかを見る。Base と無言 Character に「」を置かない。行末 `text:` はパーサの互換で抜くが、Markdown には書かない。
- **R-TXT-02** 無言の Character に `speech bubble` と「」を付けない。空の楕円を足さない。通常フキダシが1つも無いページの Base に `speech bubble` を置かない。無言を日本語で説明しない。
- **R-TXT-03** 画像内文字（セリフ・思考・擬音）付きで `no text` を出さない。Quality Tags は指定なし。審美は Base へ `very aesthetic, masterpiece`。UC から `text` を外す。
- **R-TXT-04** 1コマあたりフキダシは1〜2。本数を落とさない。足りなければページを分ける。同一ページで通常フキダシと思考を混ぜない。『』は描かない。地の文を「」にしない。思考は `thought bubble` とその Character の「」。思考だけのページは Base を `thought bubble, japanese text, text` にし、`speech bubble` は置かない。フキダシの中に顔・ちびを描かない。
- **R-TXT-05** しっぽ位置の日本語（口・口元・頭の真上・足元・枠）は出さない。通常セリフにしっぽ無し楕円・短冊を使わない。話者は顔が見える Character に `speech bubble` と「」を付ける。話者はフキダシの主。コマ説明に別人がいても、セリフは発話者の顔カードへ。
- **R-TXT-06** 擬音は既定では置かない。出すときはセリフと混ぜない（一括ページ生成の実測）。セリフは話者末尾の「」のまま `Text:` へ。擬音は同じ「」に入れず、`Text:` にも入れない。そのコマの主カードに `sfx「ザー」` と音源の位置（`near the door` 等）を書く。生成時に `free-standing handwritten manga sound effect text "ザー"` へ展開し、セリフの `Text:` からは外す。`sound effects` だけは字形を指定しないので既定では置かない。1ページの本数は脚本が 0〜1 ならそれに従う。
- **R-TXT-07** 文字なし指定：`speech bubble` / `sound effects` / `text:` / 「」 / `Text:` を出さない。Quality Tags は標準。UC へ `text, logo, watermark, signature` を足してよい。
- **R-TXT-08** 小説の「」を生貼りしない。目安 8〜24字、最大40字前後。声（語尾・呼び方・間延び）は残す。切る直前に `guidelines/02-narrative-craft.md` §4-10。状況の説明と依頼の言い直しを足さない。行為者・態・否定が入れ替わる切れ方はしない。「ながら」「たまま」「て」は形だけでは落とさない。
- **R-TXT-09** 話者の顔が見える Character にだけ `speech bubble` と「」を置く。胸・腰・手元・後頭部だけのカードには置かない。`open mouth` は表情。
- **R-TXT-10** 黒帯・タイトル・キャプションを抑えるため、漫画ページの Base に `-1.5::title ::, -1.5::caption ::`。プロンプトへ「黒帯」「キャプション」「画面上端」の日本語は書かない。

## 画面 R-LAY

- **R-LAY-01** 1生成＝1ページ。挿絵1枚、またはユーザーが求めた漫画ページ。縦スクロールWEBTOON連作は出さない。公式テスト上限の22人やフル話を目標にしない。
- **R-LAY-02** 漫画ページは英語タグ `manga, comic, comic panel` と `2koma` / `3koma` / `4koma`。続けて [Layout_Skeletons.md](Layout_Skeletons.md) の階層英語（ページ→段→列→入れ子。1行、カンマ区切り）。コマの位置は `## 配置` のピン。Base に日本語のコマ割り文、YAML、JSON、`Comic page composition:` 見出しを書かない。`3koma` だけで等分の縦3段にしない。
- **R-LAY-03** 読み順はピンの座標。骨格ごとのピン目安は [Layout_Skeletons.md](Layout_Skeletons.md)。2koma で y=50 に置かない（中段が生える）。縦4は 2×2 になりやすい（community）。縦長キャンバスと「not a two-by-two grid」で補強する。
- **R-LAY-04** ピンは Character 番号＝出現単位。対象コマ矩形の中央付近。重ねない（15以上離す）。座標は `## 配置` だけ。プロンプトへ埋め込まない。階層英語は骨格、位置はピン。ピン無しで階層英語だけ足して直さない。日本語のコマ割り文も足さない。人物のいないコマにピンを置かない。
- **R-LAY-05** Base の人数タグはユニーク人数。同一人物を複数コマに出すときは Character をコマ分に分ける。脚だけ・手元だけの端役にカードを作らない。使わないカードは削除する。出現より多いカードを置かない。余った小コマに立ち絵を足さない。同一コマの二人目カードには `full body` / `cowboy shot` / `upper body` / `close-up` のどれかを付ける。同一コマのツーショットはピンを同じコマ矩形内へ。左右が軸なら読者から見て Character に `on the right` / `on the left`。セリフは発話者だけ。余ったセリフを別カードへ付けてコマを増やさない。
- **R-LAY-06** 同一場面・同一体勢で左右／上下の軸を逆転させない。1コマは1時点。行為があるコマから行為者の身体を外さない。顔の寄りは1ページ1つまで。再生（画面の中）と今の身体を同一コマにしない。
- **R-LAY-07** 1ページの場所は1系統。室内と屋外を混ぜない。場所タグは Base。寄りの Character に家具を全コピーしない。画面の中の場所は画面カード。Base の行為は今の場。再生の体勢を Base に置かない。
- **R-LAY-08** 漫画ページは2〜4コマから始める。コマと人数が増えるほど崩れる（community）。小サイズは使わない。

## 画風 R-STY

- **R-STY-01** 未指定はフルカラー。`artist:` は今回の依頼が明示したときだけ。人数直後 `anime illustration, official art, soft shading, clean lineart, high complexity, depthness`。画像内文字付きは続けて `very aesthetic, masterpiece`。文字なし単体は審美を Base で繰り返さない。挿絵1枚に使う。漫画ページは R-STY-02。
- **R-STY-02** 漫画ページの塗りは R-STY-01 と同じ画風セットを人数の直後に置く。`crisp lineart` / `defined outlines` / `thick outlines` / `cel shading` / `clear color separation` / `high contrast` は漫画 Base に置かない。`monochrome` / `greyscale` / `screentone` も置かない。白黒・モノクロ指定が来てもフルカラーのまま組む。`artist:` は R-STY-01 と同じ。検討用の調査は [Color_Manga_Style_Tags.md](Color_Manga_Style_Tags.md)（既定は変えない）。
- **R-STY-03** `traditional media` / `marker (medium)` / 他の `(medium)` はユーザーが画材を出したときだけ。`shiny skin`, `soft lighting`, `detailed eyes`, `anime coloring` は既定にしない。
- **R-STY-04** `photorealistic`, `realistic`, `photo`, `photograph`, `3d`, `blender`, `raw photo`, `instagram` を出さない。`background dataset,` は二次元人物では使わない。
- **R-STY-05** ユーザーが `artist:` を出したら先頭に置く。V4.5 Artist Mix を自動移植しない。

## タグ R-TAG

- **R-TAG-01** Character は `girl` / `boy` / `other` で始める（`1girl` は Base だけ）。毎回、凍結した外見をフルで書く。核の髪・目・体型・服の色は `1.2::tag ::` で行為より前。Identity を削って State を足さない。同じ服の色タグをページ間で変えない。
- **R-TAG-02** Base / Character / UC は英語タグ。日本語はセリフの `「」` と、擬音の `sfx「」` だけ。関係・配置・行為・読み順を日本語自然文にしない。切り分けは [Workflow_Single.md](Workflow_Single.md)。
- **R-TAG-03** 視点は誰の目か。見上げ／見下ろしはカメラ。混ぜて `from below` だけにしない。翻訳は [Workflow_Single.md](Workflow_Single.md)。
- **R-TAG-04** 接触は Character に `source#` / `target#` / `mutual#` を1つ。主語はカードの人物。両手同時は1プレイとして両方残す。`source#anal fingering` は出さない。
- **R-TAG-05** 画面全体の反対体位・反対軸は Base の `-1::` / `-2::` を1セット。Character へ同じ語をコピーしない。その人だけ壊れる語だけ Character。同一欄の同じ打ち消しは1つ。UC と数値打ち消しを同じ語で重ねない。同じ `tag` を Base と Character に並べない。
- **R-TAG-06** 強調は `{tag}` / `[tag]` / `1.5::tag ::` / `-1::tag ::` のみ。`(tag)` は出さない。UI Character と `|` 区切りを同時に使わない。0より大きく1未満の数値強調は 2026-08-22 修正済み。修正前の実験結果は再試験する（[NAI_V5_Current_Spec.md](NAI_V5_Current_Spec.md)）。
- **R-TAG-07** モードはアニメ。ケモノ指定時だけケモノ。UIが足すデータセットタグを Base で繰り返さない。
- **R-TAG-08** 全プロンプト合計 1471 トークン以内。V4.5 の 512上限・英語ASCII強制を移植しない。
- **R-TAG-09** 識別小物（包帯・眼鏡等）は一人の Character にだけ付ける。
- **R-TAG-10** 体型は依頼・原作の指定に従う。均さない。指定が無いときだけ体型タグを足さない。`adult` や児童体型の注記を毎回書かない。体格差は `size difference` と体型タグ。日本語の錨文は出さない。`chibi` を小柄の代替にしない（UC の chibi は挿入顔用。R-API-05）。
- **R-TAG-11** 同一人物を複数コマに出すときはカードをコマ分に分け、外見凍結をフルコピーし、カメラと今の状態だけ変える。全コマを `close-up` にしない。同一人物の全カードを `looking at viewer` や `looking at another` だけに揃えない。領域語だけでは隣接コマが同じ立ち絵にクローンする。脚本の働き・主対象を Character の動作タグにする。
- **R-TAG-12** 英語タグと日本語名を同じ概念で並べない。`「」` 以外に日本語を置かない。
- **R-TAG-13** 体位語彙は [R18_2D_Pose_Play_Lexicon.md](R18_2D_Pose_Play_Lexicon.md)。無ければ Danbooru 一般語彙で組み、出力末尾に注記する。キャラクターイメージの指名は [Character_Tag_Lookup.md](Character_Tag_Lookup.md)。辞書が無ければ分解。
- **R-TAG-14** 漫画ページの Character は「人物」ではなく **出現単位**（人物×コマ）。対象コマはピン。領域語（`upper-right panel` 等）は [Layout_Skeletons.md](Layout_Skeletons.md)。日本語で「上のコマ」と書かない。
- **R-TAG-15** キャラクターの差し替えは上書きする。以前のキャラタグは残さない。正のタグとしても、`-1::` としても、作品名だけとしても、どの Character にも引き継がない。`girl` / `boy` / `other` の直後は、今の人物の辞書タグだけ（[Character_Tag_Lookup.md](Character_Tag_Lookup.md)）。名前の無い端役はキャラクタータグを置かない。ポーズ・視線・体位の `-1::` は R-TAG-05。
- **R-TAG-16** 修正版プロンプトでは、差し替える前の作品タグと人物タグを出さない。その人物の位置は空にする。辞書の現行タグだけを置く。旧タグは正にも `-1::` にも残さない。

## NSFW R-NSF

- **R-NSF-01** ペニスまたはヴァギナが見える画面は Base に `mosaic censoring, censored`（`nsfw, rating:explicit` の直後）。`uncensored` は Base に置かない。UC へ `uncensored` を入れて抑える。顔・食卓だけ、胸だけの露出には足さない。`bar censor` / `convenient censoring` は既定にしない。ユーザーが無修正を求めても外さない。
- **R-NSF-02** 成人向けは V5 Full。`nsfw, rating:explicit` は Base に置く（順は [Workflow_Single.md](Workflow_Single.md)）。Curated は成人に使わない。性行為コマの UC に `extra penises, extra arms, fused bodies, extra legs, uncensored` を足す。

## API R-API

- **R-API-01** ステップ23、プロンプトガイダンス5、Euler Ancestral、832×1216。追従不足は6。7はしっぽ・輪郭が伸びやすいので漫画既定にしない。28超または大サイズは Anlas。多様性・ノイズスケジュールはV5に無い。
- **R-API-02** 透過トグルと Base の `transparent background` を重ねない。強調するならトグルオフで `2.1::transparent background::` のみ。
- **R-API-03** 精密参照 / NovelAIポーション / Style Reference の指示は出さない。参照スロットは i2i のみ。添付はタグ化する。提供時期は [NAI_V5_Current_Spec.md](NAI_V5_Current_Spec.md)。
- **R-API-04** トークンをチャット・Issue・コミット・ログ・Skill出力に出さない。ブラウザ自動化はしない。
- **R-API-05** 挿絵既定 UC と漫画既定 UC の原文は [Lint.md](Lint.md)。どちらも `text` / `comic` / `multiple views` / `negative space` / `blank page` は入れない。UC Preset は指定なし。画像内文字付きは `distorted text, unreadable text, cropped speech bubble, furigana`。`chibi, extra faces, floating head` は既定に含める（体型の `short` とは別。同じ語を Base の `-1::` と重ねない、R-TAG-05）。単一イラストでコマ割りしないときだけ `multiple views` を足してよい。
- **R-API-06** プロンプトだけを頼まれたときは、Markdown を保存して実生成しない。承認を待つ。確認ゲートの手順は SKILL.md。生成まで頼まれたときは、このゲートで止めない。`AGENTS.md` の連続執筆モードは、プロンプトだけの確認ゲートを消さない。
- **R-API-07** 既定は、タグを書いて各ページを1回だけ生成する（`--count` は1）。PNGを見ない。再生成しない。生成後にタグを直さない。生成結果の確認（保存したPNGを見て選別・再生成を判断すること）と、同じプロンプトの3回出力（`--count 3` で候補を足すこと）は、ユーザーがそれを明示したときだけ行う。明示の例は「確認して」「画像を確認して」「生成結果を確認して」「選別」「問題ページだけ再生成」「3回出して」「3枚出して」「解析して打ち直して」「プロンプト修正して生成選別」。『生成して』『OK』は1回出しであり、確認と3回出力には入らない。1ページ目を見てから残りを出すことも、この確認に含む。手順は [Review_And_Regen.md](Review_And_Regen.md)。
