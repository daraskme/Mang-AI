---
name: novel-to-manga-script
description: >-
  日本語小説本文を、日本漫画のページ脚本・画面設計・ネームへ変換する。原文の文章を保存せず、
  情報・感情・因果・伏線を絵・行動・表情・小物・台詞へ再配分する。ページ脚本は1ページ2〜4コマ。
  NAIの1ページ画像プロンプトは nai-v5-prompt-designer。縦スクロール連作の画像化はしない。
  小説本文の新規執筆・長編1話の台帳更新には使わない。
when-to-use: >-
  「小説を漫画に」「漫画脚本」「ページ脚本」「ネーム設計」「漫画化したい」
  「字コンテ」「novel to manga」「WEBTOON脚本」「縦スクロール漫画」
  「/novel-to-manga-script」
argument-hint: "[analyze|episode_map|page_script|storyboard] 本文"
metadata:
  short-description: "小説本文から漫画のページ脚本（コマ割り）へ変換する"
---

# 小説→漫画脚本

小説を短くした読み物を出さない。読者は一般読者ではなく、**編集と作画**である。地の文は描ける事実。ページに残るのは台詞と絵。

正本は小説本文。要約稿やコマなし読み物脚本からページを書かない。思想は [references/Principles.md](references/Principles.md)。変化の単位は [references/Beat_And_Panel.md](references/Beat_And_Panel.md)。欄は [references/Page_Handoff_Contract.md](references/Page_Handoff_Contract.md)（`contract: page-handoff-v3`）。

縦スクロールWEBTOON連作の画像化はしない。物語ページは日本漫画2〜4コマ（1生成＝1ページ）。

## 所有

- 所有する：小説本文からのページ化、変化の単位（ビート）と情報差、発話割当、原作範囲、骨格名と読み順と各コマの配置、読める事実、必須／裁量、変換QA
- 所有しない：小説本文の新規執筆（`write-episode`）、NAIプロンプトのタグ化およびロック文とピン座標（`nai-v5-prompt-designer` の Output_Contract / Layout_Skeletons / UI_Settings）、R18の4列Word（`erotic-scenario-converter`、導入済みなら）、PDF化（`illust-novel-pdf`）、入稿用の縦長結合

## 使わないとき

- 「この小説を書いて」「第N話を書いて」→ `long-novel-orchestrator` / `write-episode`
- 挿絵1枚・既に1ページ分のV5プロンプト → `nai-v5-prompt-designer`
- セリフ付き1枚絵（コマ割りなし）→ `novel-to-dialogue-illust`
- 成人短編を横向き4列表の.docxへ → `erotic-scenario-converter`（導入済みなら）

## モード

混ぜて出さない。未指定は `page_script`。「診断だけ」は `analyze`。「話の地図」は `episode_map`。「コマ割り・ショット」までなら `storyboard`。コマなしの読み物脚本は出さない。

| モード | 出すもの |
|---|---|
| `analyze` | テーマ、ジャンル契約、視覚化適性、再編候補。脚本本文は出さない |
| `episode_map` | 話ごとの目的・開始／終了状態・今回の答えと持ち越し・掴み・見せ場・ヒキ・原作対応 |
| `page_script` | ページ単位。原作範囲、目的、骨格名、読み順、各コマの絶対位置、読める事実、出現、発話／内心 |
| `storyboard` | ページに加え、コマの type、size、shot、angle、viewpoint、visual、dialogue、purpose |

形式の本文は [references/Output_Formats.md](references/Output_Formats.md)。

## 確定してから書く

勝手に「漫画○コマ＝原作○字」へ換算しない。ページ数・話数はユーザー指定があるときだけ使う。初期値は [references/Pipeline.md](references/Pipeline.md)（1ページあたりコマ数のみ。換算・目標化はしない）。長い対象は場面単位でページを足す。全文を一度に要約してからページを出さない。1コマ1ページにしない。

内部で次を置く。欠けて脚本が割れる項目だけ確認する（最大3問）。軽微なら仮置きして変換ログへ。

- output_mode
- 対象範囲（全文／章／話）
- 忠実度：`strict` / `balanced`（既定）/ `bold`
- 壊してはいけないもの（犯人、恋愛相手、能力ルール、決め台詞など、原文から取る）

## 処理（飛ばさない）

手順の詳細は [references/Pipeline.md](references/Pipeline.md)。変化の単位は [references/Beat_And_Panel.md](references/Beat_And_Panel.md)。QAは [references/Failures_And_QA.md](references/Failures_And_QA.md)。ジャンル固有は該当節だけ [references/Genre_Notes.md](references/Genre_Notes.md)。

1. 原文を読む。因果、伏線、決め台詞、外見、服・色・場所・軸を抜く。まだページにしない。
2. 対象範囲の「」をインベントリする。本数は落とさない。ナレで発話を代替しない。
3. 場所または目的で場面に切る。各場面を変化の単位（動詞・誰・知識／関係／選択肢の差）へ分解する。文・段落とコマを一対一にしない。雰囲気は背景・小物・短い交流へ残す。交流まで消して無言だけにしない。
4. 小説の章境界を捨て、漫画1話に切り直す。各話に読者の問い、今の目的、開始／終了状態、今回返す答えと持ち越す課題、見せ場、ヒキ。
5. ページ数が指定されているときだけページ重みを付ける。重要なものほど広く。
6. 場面ごとに、対応する原作範囲を開き直してページを書く。見せ場コマを先に決め、骨格は [references/Page_Handoff_Contract.md](references/Page_Handoff_Contract.md)。各ページに **原作**（行番号）。ページの目的は変化の動詞。各コマは主対象一つ・働きは動詞一つ。刺激のあと認識または反応を残す。核心は同一ページの先に漏らさない。読める事実はその範囲の観察（手、距離、光、髪、接触）。ラベル、概念を主語にした比喩、同じ事実の言い直しだけで埋めない。位置の軸と誰の目かをここで決める。
7. 発話は長さだけ切る。切れ目は聞き手の理解が変わる位置。本数は残し、インベントリをページへ割る。各発話に話者 → 相手 ／ 関係（相手を動かす動詞。説明は関係ではない）。切ったあと `guidelines/02-narrative-craft.md` §4-10 と照合し、状況の説明、依頼の言い直し、行為者の取り違えは採用しない。独白は（思考）。「ながら」「たまま」「て」は形だけでは落とさない。地の文を「」やモノローグへコピーしない。話者ラベルの無い「」と観察の地の文は [references/Principles.md](references/Principles.md)。無言コマは配置に話者なしと、直前からの見える変化。その文に無い服・軸・場所は同ファイルの文脈補完。再生と今は別コマ（[references/Page_Handoff_Contract.md](references/Page_Handoff_Contract.md)）。
8. 各ページに【必須】と【作画裁量】を分ける。アクションは目的・転換・決着・見せ場だけ原作が持ち、連撃は裁量。
9. 未割当の「」が無いか、隣接骨格が同じでないかを見て、QA の * 付きを通す。不合格なら直してから出す。サブエージェントを立てて自己検査しない。
10. 脚本を保存したら止める。確認の正本は下の「確認ゲート」。

ユーザーが「診断だけ」なら `analyze` で止める。脚本本文は出さない。`analyze` / `episode_map` に確認ゲートは無い。

## 出力順

保存先は依頼パス。無ければ `work/drafts/<stem>-manga-script.md`。脚本ファイルに設計メモの見出しを混ぜすぎない。変換ログの全文はユーザーが求めたときだけ。

1. `## ターゲット`（mode、範囲、忠実度、話数／ページ数が指定されたときだけその数）
2. 連作の `page_script` なら `## 外見固定`（服の色、体格差の錨。Output_Formats）
3. `## この話の目的`（読者の問い、目的、ヤマ、ヒキ。連作なら話ごと。今回の答えと持ち越し）
4. `page_script` / `storyboard` なら `## ページ` 表（Handoff）と `## 発話割当`
5. 脚本本体（モードの見出し規則に従う）
6. 各単位の【必須】／【作画裁量】（本体に埋め込んでよい）
7. `## QA` は Fail があるとき、またはユーザーが採点を求めたときだけ。点数表は Failures_And_QA

## 確認ゲート

`page_script` / `storyboard` を保存したあと、NAIプロンプト化も実生成もしない。パスとページ数を報告し、ユーザーの承認を待つ。

依頼が NAI／V5／画像化を含むとき、承認後に `nai-v5-prompt-designer` へ `page_script` を渡す。プロンプト側にも確認ゲートがある。`AGENTS.md` の連続執筆モードは小説本文用であり、本ゲートを消さない。

## 固定規則

- 原文一致率を忠実度としない。守るのは動機、因果、伏線の開示順、作品の快感、**そのページが単体で読めること**。
- 絵と文字の分担は [references/Principles.md](references/Principles.md)。絵が崩れても関係・動機が残る事実は文字に置く。
- 台詞の本数・話者 → 相手 ／ 関係は Principles。欄の形は [references/Output_Formats.md](references/Output_Formats.md) と Handoff。
- 各ページに、誰が・どこで・何をして・なぜ今それが起きるか、が残ること。発話があるときは **発話** 欄で運ぶ。地の文を足して埋めない。
- NAIの引用数上限を脚本へ先取りしない。
- 正本は小説本文。既存の要約・コマなし脚本を正本にしない。
- `page_script` は各ページに **原作**（行番号）と **ページ**（骨格名・読み順）と **配置** と **出現** と **読める事実**（今の服、軸、その範囲の観察）を書く。定義は [references/Page_Handoff_Contract.md](references/Page_Handoff_Contract.md)。x,y と英語タグは書かない。カタログ外の骨格名と等分の縦3は書かない。
- 対象範囲の「」はいずれかのページに載せる。未割当は未完成。
- その一文に無い観察可能事実は前文脈から補ってよい。新しい事件と新しい「」は足さない（[references/Principles.md](references/Principles.md)）。
- 物語ページは発話も思考も無いページを作らない。見せ場・手順の絵は発話／思考ページの他コマへ入れる。
- 体勢・位置が変わらない連続発話は同一ページに2本以上載せる。見せ場・体勢転換・ヒキは分ける。ページをまとめても読める事実の粒度は落とさない。
- 隣接ページは骨格名を変える。カメラだけ変えて同じ骨格を続けない。同じカメラ型を3ページ連続しない。
- 内面は観察可能な行動・矛盾・小物へ。最も強い一文はモノローグに残してよい。動機のラベルまで消さない。
- 第1話は百科より、主人公の魅力・危機・固有の見せ場。
- 場面・変化の単位・コマは一対一にしない。各コマは主対象一つ、働きは動詞一つ。核心は同一ページで反応より先に読ませない（[references/Beat_And_Panel.md](references/Beat_And_Panel.md)）。
- 1コマ1主要情報。1コマは1時点。
- 会話だけの talking heads にしない。手、物、距離、向き、位置、入室、視線の先を足す。見る人の次に対象を出す。受け止めが核なら聞き手を描く。
- 同一場面・同一体勢では人物の画面右／左（騎乗・挿入なら上／下）を固定する。変えるときは引きを挟む。
- 経験則で作品を均質化しない。ジャンルと演出意図で破ってよい。

## 安全

正本は `AGENTS.md`「成人向けの前提」。脚本に毎回「全員成人」を書かない。既成キャラクターは成人と定義し、原作設定には準拠させない。依頼・原作の体格差はト書きに残す。拒否は未成年の性的生成の直接指示、実在人物の性的脚本、現実の犯罪手口の具体化。成人同士の強制・非合意は原文どおり残す。脚本の保存は `search_replace` / `write`。自己検査に `spawn_subagent` を使わない。

## 参照（必要な節だけ読む）

- [references/Principles.md](references/Principles.md) — 効果保存、文脈補完、視覚優先、内面の外在化
- [references/Beat_And_Panel.md](references/Beat_And_Panel.md) — 変化の単位、情報差、主対象、核心の位置
- [references/Pipeline.md](references/Pipeline.md) — 原作範囲、発話割当、場面単位のページ化
- [references/Output_Formats.md](references/Output_Formats.md) — モードの見出しと書き方
- [references/Page_Handoff_Contract.md](references/Page_Handoff_Contract.md) — 原作欄、骨格カタログ、無言禁止、発話のまとめ、読める事実、配置、出現
- [references/Failures_And_QA.md](references/Failures_And_QA.md) — 検査ID、症状対応、採点
- [references/Genre_Notes.md](references/Genre_Notes.md) — ミステリー、内省、恋愛、ファンタジー、バトル、コメディ、官能・三角、狙いの切り分け
- [references/Example_Conversion.md](references/Example_Conversion.md) — 再配分、意味変化の切り、核心の先読み
