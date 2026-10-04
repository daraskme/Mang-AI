---
name: write-episode
description: >-
  長編の1話を、設計確認、文体Skillによる本文生成、validate-episode修正モード、
  正典・状態台帳更新まで完遂する内部ワークフロー。通常はlong-novel-orchestratorから
  話数と制約を受けて使う。既存本文だけの検査・改稿、複数話の統括、プロット・世界観相談には使わない。
when-to-use: >-
  ユーザーがwrite-episodeを明示したとき、long-novel-orchestratorから1話の完遂を委譲されたとき、
  「/write-episode」
argument-hint: "第N話 | epNNN"
metadata:
  short-description: "一話を設計確認から本文執筆・検証・正典と台帳更新まで完遂"
---

# write-episode：1話執筆ワークフロー

長編全体を統括せず、指定された1話だけを完成状態へ進める。暗黙の新規執筆依頼は `long-novel-orchestrator` が入口となる。

ユーザーまたは `long-novel-orchestrator` が指定した `12`、`ep12`、`ep012` などの話数を既存命名に合わせて正規化する。scene-card は `work/scene-cards/ep012.md`、本文は `work/drafts/episode012.txt` とする。全段階を通過するまで「完成」と報告しない。

## Step 0. 前提を整える

対象話の scene-card と、その話に必要な設計資料が揃っているかを確認する。

scene-cardがない、または軽微な項目が不足している場合は、`templates/scene-card.md`、plot、pov-plan、正典から保守的に作成・補完する。補完内容は後で状態差分に記録する。人物の根幹、世界法則、主要筋など正典を大きく変える判断が必要な場合だけ、本文確定前にユーザーへ確認する。連続執筆モード中の扱いは `AGENTS.md` の「連続執筆モード」を正本とする。基礎資料がなく合理的に設計できない場合は停止し、不足を具体的に報告する。

## Step 1. 必要資料を読む

読む順序は `AGENTS.md` の読み込み戦略を正本とする。各資料から取り出すのは次の項目である。

- current-state：位置、負傷、所持品、関係、継続中の圧力
- scene-card：GMC、進捗、引き、must_use_facts、NG語
- pov-plan：場面割当と、視点人物が知らない情報
- character-sheet（視点人物と相手役）：一人称、呼称、語尾、禁則語、知覚の癖
- style-samples：作品の基調と、当該視点人物の地の文サンプル。規約ではなく実例に合わせる
- plot：作品基本情報、読者への約束・投稿戦略ブリーフ、現在アークと前後3話
- world-bible：`00-INDEX.md` が指定する正典。canon-log と timeline は `AGENTS.md` 読み込み戦略の部分読み範囲（直近3話分の節＋関連語の検索、§3直近数行）だけ
- 前話ドラフト末尾の1場面（第1話では不要）
- 地の文を書く・言い換える直前：`guidelines/02-narrative-craft.md` §2-8。台詞を書く・短くする話は同 §4-10。表現の採否で迷う箇所だけ `guidelines/05-ai-guardrails.md` §3-4

巨大な資料を無差別に全文読み込みしない。アーク境界、重大な矛盾の疑い、正典変更時だけ範囲を広げる。

## Step 1.5. 制約を逐語引用で確定する

本文を書く前に、今回の執筆を縛る事実を資料から**逐語で引用**した制約ブロックを作る。要約や記憶で代替しない。資料を読んだつもりで書き始めることが、人物像・情報格差・時系列が破綻する最大の原因である。

引用するのは次に限る。今回使わない事実や長い引用は入れない。

- current-state から、登場人物の位置・負傷・所持品・関係の該当行
- pov-plan の情報格差マトリクスから、今回の視点人物が知らない事実の行
- character-sheet から、今回話す人物の一人称・二人称・呼称・語尾・禁則語の該当行
- 視点人物の character-sheet §視点フィルタから、飽和注意語と「職能比喩が偏る範囲」の行（禁止リストではない。`02-narrative-craft §2-7`）
- scene-card の must_use_facts と NG語
- timeline から、直前話の作中日時と今回の想定日時
- 戦闘・装備が登場する場合、正典・current-state・character-sheetから装備の形式、主要部位、収納・装着状態、損耗、所持数の該当行

制約ブロックは `work/continuity/episodes/ep<NNN>.md` の冒頭へそのまま残し、Step 4 と Step 5 で参照する。

戦闘、武器、防具、携行具が登場する場合は、本文生成前に `check-combat-equipment-terms` の予防モードを使う。登場装備ごとに「形式・主要部位・開始状態・使用時の遷移・許容動詞・助数詞」を確定し、根拠のある項目だけを制約ブロックへ反映する。形式が未確定の専門語を補完してはならない。

引用した内容と scene-card の指定が食い違う場合は、本文を書かずに矛盾を報告する。

## Step 2. 本文を書く

- 非R18本文は `narrative-style-web-novel` を使う。依頼、scene-card、plotの順に文体モードを決め、指定がなければ作品の既存文体へ合わせる。
- 明示された成人向け場面だけ `novel-write-r18` を使う。同Skillの適用条件を満たさなければ停止する。地の文の言い換えは同Skillの `vocab-remap.md` 経由で読む。
- 曇らせ、救済、感情曲線、R18の行為内容・嗜好は文体Skillで設計せず、plotとscene-cardを正本とする。
- 視点・地の文・台詞は `guidelines/02-narrative-craft.md`（地の文は §2-8、台詞の生成・短縮の直前は §4-10）、表現の採否は `guidelines/05-ai-guardrails.md` §3-4・§3-5。規則は再掲せず、生成時から守る。検証段階で直す前提で書かない。
- 装備の部位、収納、構え、装填、使用、回収、手入れは `check-combat-equipment-terms` の装備構造カードと状態遷移に従う。専門語を迫力の装飾として足さない。
- 本文だけを `work/drafts/episode<NNN>.txt` にプレーンテキストで保存する（`search_replace` または `write`）。
- plotの長さ方針を参照する。本作では文字数の上限・下限を設けず、場面の状態変化と読後の切れ目が成立する必要量で閉じる。`scripts/chars.sh` の計測値は完成後の実績記録にのみ使う。
- scene-cardの「今回返す約束」を本文上の具体的な選択・結果・関係変化として実現する。市場ブリーフの語句や流行要素を本文へそのまま貼らず、作品固有の核と正典を優先する。

## Step 3. `validate-episode` の修正モードを通す

本文ファイルを `validate-episode` へ渡し、**修正モード**で実行する。機械検出、視点・キャラ・情報格差照合、ai-novel-detector診断、humanize-ai-writingによる必要箇所の改稿、再検証の詳細手順は同Skillを正本とし、ここへ重複記載しない。

`validate-episode` の報告項目がすべて揃い、未解決事項がない（または意図的残置の根拠が示された）状態になるまでStep 4へ進まない。

## Step 4. 確定本文を台帳へ反映する

- `world-bible/log/canon-log.md`：本文で確定した事項だけを追記する（append-only）
- `world-bible/core/08-timeline.md`：当該話の作中時刻・出来事を反映する
- `work/pov-plan.md`：開示・伝達された事実を情報格差へ反映する
- `work/continuity/episodes/ep<NNN>.md`：`templates/episode-state-delta.md` に従い差分を記録する
- `work/continuity/current-state.md`：確定本文の終了状態へ更新する

予定や解釈を正典化しない。本文の最終改稿後に生じた状態だけを記録する。

更新後に台帳の整合を機械照合する。`run_terminal_command` で実行する。インタプリタは `AGENTS.md` シェル実行の規約。

```bash
python3 scripts/state_check.py --strict
```

`[NG]` が残っている状態でStep 5へ進まない。`[警告]` は作品意図に照らして採否を決め、残す場合は理由を報告する。

## Step 5. 完了を報告する

- 本文ファイルと空白除外文字数
- Step 1.5 の制約ブロックとの照合結果
- `validate-episode` 修正モードの報告（項目は同Skillの報告節を正本とし、ここへ再掲しない）
- 台帳更新の証跡（canon-log・timeline・pov-plan・episode差分・current-state）と `state_check.py` の最終結果
- scene-cardの「引き」「今回返す約束」「作品固有の核」の達成・保持

必要な証跡が一つでも欠ける場合は、未完了としてその段階を報告する。
