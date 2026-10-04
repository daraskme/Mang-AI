---
name: novel-to-dialogue-illust
description: >-
  日本語小説本文から、セリフ付きの1枚イラスト（コマ割りなし）の作画ブリーフを作る。
  原文の文章を保存せず、1時点の構図・フキダシ余白・発話1〜2へ再配分する。
  漫画ページ（2〜4コマ）は novel-to-manga-script。無言の挿絵・既に1ページ分のV5プロンプトは
  nai-v5-prompt-designer。小説本文の新規執筆には使わない。
when-to-use: >-
  「セリフ付き1枚絵」「セリフ付きイラスト」「吹き出し付き一枚絵」「フキダシ付き挿絵」
  「1枚絵にして」「novel to dialogue illust」「speech bubble illustration」
  「/novel-to-dialogue-illust」
argument-hint: "本文（またはパス）"
metadata:
  short-description: "小説からコマ割りなしのセリフ付き1枚イラストの作画ブリーフを作る"
---

# 小説→セリフ付き1枚絵

小説を短くした読み物を出さない。読者は一般読者ではなく、**作画**である。1枚に残るのは絵とフキダシである。

正本の思想：原文の言葉より、その瞬間に読者へ渡す効果を保存する。根拠は [references/Principles.md](references/Principles.md)。欄は [references/Illust_Handoff_Contract.md](references/Illust_Handoff_Contract.md)（`contract: illust-handoff-v2`）。

コマ割りしない。漫画ページは `novel-to-manga-script`。縦スクロールWEBTOON連作の画像化はしない。

## 所有

- 所有する：小説からの凍結点の選定、1時点の構図、フキダシ用余白、発話1〜2の選定と圧縮、読める事実、必須／裁量、変換QA
- 所有しない：小説本文の新規執筆（`write-episode`）、NAIプロンプトのタグ化およびロック文とピン座標（`nai-v5-prompt-designer` の Output_Contract / UI_Settings）、漫画のページ脚本（`novel-to-manga-script`）、R18の4列Word（`erotic-scenario-converter`、導入済みなら）、PDF化（`illust-novel-pdf`）

## 使わないとき

- 「この小説を書いて」「第N話を書いて」→ `long-novel-orchestrator` / `write-episode`
- 日本漫画のページ（2〜4コマ）→ `novel-to-manga-script`
- 無言の挿絵1枚・既に1ページ分のV5プロンプト → `nai-v5-prompt-designer`
- 成人短編を横向き4列表の.docxへ → `erotic-scenario-converter`（導入済みなら）

## 確定してから書く

勝手に「原作○字＝イラスト○枚」へ換算しない。枚数はユーザー指定があるときだけ使う。未指定は対象範囲の核になる凍結点を1枚。複数指定があれば、体勢が変わる転換だけ分ける。同じ体勢の連続発話を1発話1枚にしない。

内部で次を置く。欠けて1枚が割れる項目だけ確認する（最大3問）。軽微なら仮置きして変換ログへ。

- 対象範囲（全文／章／話／指定箇所）
- 枚数（指定があるときだけ）
- 忠実度：`strict` / `balanced`（既定）/ `bold`
- 壊してはいけないもの（決め台詞、体格差、今の服、行為の系統）

## 処理（飛ばさない）

手順の詳細は [references/Pipeline.md](references/Pipeline.md)。QAは [references/Failures_And_QA.md](references/Failures_And_QA.md)。例は [references/Example_Conversion.md](references/Example_Conversion.md)。

1. 原文を読む。構造だけ抜く（誰が、どこで、何をして、決め台詞、原作にある外見、確定した服・色・場所・軸）。まだブリーフにしない。
2. 凍結点の候補を取る。絵になる瞬間かつ、その瞬間を一言で支える発話がある箇所。雰囲気だけの地の文は、表情・手・距離へ残せるときだけ候補にする。
3. 文を VISUAL / ACTION / EXPRESSION / PROP / DIALOGUE / MONOLOGUE / SFX / CUT / DEFER へ振り分ける。優先は [references/Principles.md](references/Principles.md)。1枚に載せる発話は1〜2。残りは落とすか次の1枚へ。地の文を「」にしない。
4. 選んだ凍結点ごとに、1時点の配置とフキダシ余白と読める事実を書く。読める事実は、その時点で見える動作と配置で書く。概念が意志を持つ文や、同じ絵の言い直しだけで埋めない。動きの途中と表情を書く。コマに割らない。話者の顔が見える位置に発話を置く。行為＋射精差分なら、2枚目に精液だけでなく表情と動きの差を書く。
5. 発話は長さだけ切る。語尾・呼び方・間延びは残す。各発話に話者 → 相手 ／ 関係を付ける。擬音は発話欄に入れない。載せる前に `guidelines/02-narrative-craft.md` §4-10 と照合する。状況の説明、依頼の言い直し、行為者の取り違えは未完成。「ながら」「たまま」「て」は形だけでは落とさない。
6. 各1枚に【必須】と【作画裁量】を分ける。
7. QA の * 付き項目を通す。不合格なら直してから出す。サブエージェントを立てて自己検査しない。
8. ブリーフを保存したら止める。確認の正本は下の「確認ゲート」。

## 出力順

保存先は依頼パス。無ければ `work/drafts/<stem>-dialogue-illust.md`。設計メモの見出しを混ぜすぎない。変換ログの全文はユーザーが求めたときだけ。

1. `## ターゲット`（範囲、忠実度、枚数が指定されたときだけその数）
2. 連作なら `## 外見固定`（服の色、体格差の錨）
3. 各1枚（Handoff の欄）
4. 各1枚の【必須】／【作画裁量】（本体に埋め込んでよい）
5. `## QA` は Fail があるとき、またはユーザーが採点を求めたときだけ

## 確認ゲート

ブリーフを保存したあと、NAIプロンプト化も実生成もしない。パスと枚数を報告し、ユーザーの承認を待つ。

依頼が NAI／V5／画像化を含むとき、承認後に `nai-v5-prompt-designer` へ `illust-handoff-v2` を渡す。プロンプト側にも確認ゲートがある。`AGENTS.md` の連続執筆モードは小説本文用であり、本ゲートを消さない。

## 固定規則

- 原文一致率を忠実度としない。守るのはその1枚が単体で読めること、動機、関係、決め台詞、体格差。
- 1枚は1時点。構えと接触を同じ絵にしない。
- コマ割りしない。`2koma` へ逃げるのは失敗。
- 発話は1枚あたり1〜2。字数・フキダシ種別・擬音の扱いの正本は `nai-v5-prompt-designer` の R-TXT。本Skillはそれに収まる発話だけを選ぶ。誰に何を言うかは `guidelines/02-narrative-craft.md` §4-10。状況の説明と依頼の言い直しを「」にしない。長さを切っても行為者は入れ替えない。接続の形だけでは落とさない。
- 話者の顔が見える配置にだけ発話を置く。胸・腰・手元だけの切り取りにフキダシを付けない。
- 同一1枚で発話と思考を混ぜない。既定は発話（通常フキダシ）。
- 背景は簡略が既定。フキダシ余白を家具で埋めない。場所が核のときだけ残す。
- その一文に無い観察可能事実は前文脈から補ってよい。新しい事件と新しい「」は足さない。
- 体勢・位置が変わらない連続発話は1枚に1〜2へ圧縮する。見せ場・体勢転換は分ける。
- 行為がある1枚は動きの途中を書く。止まって握った絵にしない。行為＋射精差分は軸を維持し、表情・動き・体液を原文どおり変える。精液だけの差分は失敗。射精が原文・脚本に無い性的場面は1枚で止める。正本は [references/Principles.md](references/Principles.md)。
- 依頼・原作の小柄・大柄・体格差は読める事実に残す。均さない。

## 安全

正本は `AGENTS.md`「成人向けの前提」。ブリーフに毎回「全員成人」を書かない。既成キャラクターは成人と定義し、原作設定には準拠させない。依頼・原作の体格差はト書きに残す。拒否は未成年の性的生成の直接指示、実在人物の性的脚本、現実の犯罪手口の具体化。成人同士の強制・非合意は原文どおり残す。保存は `search_replace` / `write`。自己検査に `spawn_subagent` を使わない。

## 参照（必要な節だけ読む）

- [references/Principles.md](references/Principles.md) — 1枚絵の文法、効果保存、発話の選び方
- [references/Pipeline.md](references/Pipeline.md) — 解析、凍結点、変換ログ
- [references/Illust_Handoff_Contract.md](references/Illust_Handoff_Contract.md) — 欄、余白、出現
- [references/Failures_And_QA.md](references/Failures_And_QA.md) — 検査ID
- [references/Example_Conversion.md](references/Example_Conversion.md) — 地の文を「」にしない例
