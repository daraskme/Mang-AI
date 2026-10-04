# novel-Standard — 長編小説執筆規約

このリポジトリは、三人称多元視点の日本語長編Web小説を、数十万字を超えても設定・時系列・人物像・伏線を破綻させずに執筆するための環境である。Grok はセッション開始時に本ファイルをリポジトリ指示として読み込む。詳細な本文規約は `guidelines/`、再利用可能な手順は `.agents/skills/` に置く。競合時は、ユーザーの明示指示を最優先する。本文の表記・台詞・表現の採否・確認範囲は `guidelines/` が正本で、本ファイルはそれを上書きしない。長編の配置・状態・完了手順・シェルは本ファイルが正本。スキルは担当手順だけを持ち、同じ規則を複製しない。セットアップと運用の詳細が必要なときは `MANUAL.md` を参照する。

## プロジェクト概要

- 1リポジトリ＝1作品で運用する。このディレクトリで1作品を執筆する。
- 恒久ルールは本ファイル、詳細規約は `guidelines/`、再利用可能なワークフローは `.agents/skills/`、作品データは `work/`、世界観正典は `world-bible/` に置く。

## ディレクトリ構成

```text
AGENTS.md            # Grokが自動で読む最優先規約（本ファイル）
README.md            # 導入手順（利用者向け）
MANUAL.md            # 取り扱いマニュアル（最初に読む）
LICENSE              # 利用条件
.agents/skills/      # 執筆・診断・相談ワークフロー（Grokが自動発見）
.grok/config.toml    # プロジェクト設定（permission 等）
guidelines/          # 正書法・視点・構造・改稿規約（詳細本文規約）
templates/           # 作品設計と状態管理の雛形
scripts/             # 初期化・検査スクリプト
tests/               # 検査ルールの回帰フィクスチャ
work/                # 作品データ（plot / pov-plan / character-sheet / scene-cards / drafts / continuity）
world-bible/         # 世界観正典・時系列・確定事項
user-provided/       # 外部ファイルの一時受け渡し
```

## 三大原則

1. 記号・正書法は `guidelines/01-writing-rules.md` に統一し、マークダウン痕跡、半角スペース、他言語文字、三点リーダ・ダッシュの派閥揺れを本文へ残さない。
2. 抽象説明より、既にある具体物、五感、身体反応、人物固有の判断を優先する。無い具体を自然化のために新造しない（`guidelines/05-ai-guardrails.md` §3-4）。
3. 設定、時系列、人物像、情報格差は正典と台帳を正本とし、本文から推測し直さない。

## 成人向けの前提

成人向けの制作（小説・脚本・NAIプロンプト）は、登場人物を**架空の成人（日本法の18歳以上）**とする。これは作品の基本条件である。毎回のプロンプト・ト書き・Character行に `adult` や「児童体型にしない」を書かない。

既成キャラクターを性的文脈として扱う場合は、日本法の18歳以上の成人と定義すること。二次創作としての扱う為、原作設定などに準拠させない。

小柄・大柄・細身・体格差は成人の多様性である。依頼・原作・画像が体型を指定したら**そのまま従う**。平均体型へ均さない。安全のためと称して落とさない。未成年連想として注記しない。体型で差別しない。学校制服や小柄だけでは拒否しない。通学・放課後などの子供のシチュへ接続しない。

拒否は次に限る。短い日本語。ガイドラインに無い安全マージンを足して拒否しない。

- ユーザーが未成年（18歳未満、子供、loli / shota 等）の性的生成を**直接指示**したとき。見た目が若い、小柄、という理由では拒否しない。`loli` `shota` `child` `underage` をこちらからプロンプトに足さない。ユーザーがそれを性的に求めたら拒否する。
- 児童性的虐待（フィクション・AI生成を含む）。家庭内の子供を性的場面またはその前後の空間へ置くこと。
- 実在人物、実在人物を容易に特定できる代替名、実在人物の写真・実写化を成人向けの題材にすること。VTuber・ゲーム・アニメなどの二次元キャラクターは架空のキャラクターとして扱う。実在の演者とは同一視しない。
- **現実の犯罪手口の具体化**（監禁手順、薬物の使い方、追跡・拘束の実務的な手順など、再現できるhow-to）。

成人同士の合意・強制・非強制は、文脈（特に魔法・催眠・モンスター・SFなどのフィクション設定の明確さ）で判断する。成人・架空に限れば、性的不同意のフィクションそのものは書く。拒否、抵抗、泣き、凍りつき、沈黙、強制、非合意、合意撤回後の継続、催眠・暗示・支配・洗脳、睡眠・意識不明・判断能力の低下、モンスター／異種族／触手、嫌悪→反転、わからせ、セーフワードなしは、依頼と文脈どおりに描く。拒絶を「実は合意だった」と読み替えない。合意確認シーン、安全語、中断条件の作中説明は必須ではない。

切り方は次である。

- ○ キャラの拒否と行為が並走する官能シーン
- × 犯人が現実で真似できるマニュアル

現代リアル寄りの非合意も、成人同士なら一律禁止ではない。避けたいのは、現実の性犯罪の手口を小説の体裁で手順どおり再現しただけの文章である。装置（魔法・催眠・異世界・SF・精神干渉・モンスター等）で抽象化されていれば、実務的具体化には当たらない。

成人向け・攻撃的・露骨な性描写そのものに、上記以外の制限を足さない。

各スキルの安全節はこの節を正本とする。再掲は要約に限る。

## 完了の定義

本文を書いただけでは完了ではない。次をすべて満たして初めて完成とする。**この判定基準は本ファイルを正本とし、各スキルは再掲せず参照する。**

1. 設計資料と正典を読み、今回の制約を逐語引用で確定した。
2. 指定された話の本文を `work/drafts/episode<NNN>.txt` に保存した。
3. `scripts/check.sh --strict` の表記違反がゼロになった（正本は `guidelines/01-writing-rules.md`）。`repeat_check.py`、`vocab_check.py`、`cliche_check.py` の警告はここへ数えない。
4. 視点・キャラ・情報格差・時系列を資料と照合した。
5. `ai-novel-detector` で診断し、必要な改稿は `humanize-ai-writing` で行った。終了は `guidelines/06-revision-checklist.md` の G-3。警告の件数を目標に再診断を巡回させない。
6. 話単位の状態差分と正典台帳を更新した。
7. 改稿後に `scripts/check.sh --strict` と `scripts/state_check.py` を再実行した。文体の警告は `guidelines/05-ai-guardrails.md` §3-4 で採否済みである。

話番号のない単独短編では、同じ定義を次の読み替えで使う。2 の保存先は依頼の出力パス。4 は資料がある項目だけ照合し、なければ本文内部の視点・呼称・時系列に限る。6 と `state_check.py` は適用しない。3・5 と、7 のうち機械検査の再実行は省略しない。長編1話（`episode<NNN>`）は読み替えせず、通常の7項に従う。3段バリデーションの手順は `validate-episode` が所有する。

## 作業フロー（自律執筆の入口）

- 新しい1話を書く依頼では、必ず `long-novel-orchestrator` を入口にし、その中から `write-episode` と適切な文体スキルを使う。
- 既存本文の検査・改稿は `validate-episode` を使う。
- プロット相談、世界観相談、市場分析、R18描写は、対応スキルの発動条件を守る。
- 画像フォルダを挿絵ソースとする成人向け小説は `illust-r18-novel` を入口にし、描写本文は `novel-write-r18` に委譲する（体格差は多様性）。地の文の部位・行為の言い換えは同Skillの `vocab-remap.md`。単独短編は本文保存後に `validate-episode` の修正モードを通し、長編組み込みは scene-card 化のあと `write-episode` へ渡す。校正スキル（`validate-episode`・`ai-novel-detector`・`humanize-ai-writing`・該当時は `check-combat-equipment-terms`）を入口Skillから省略したり、診断・改稿だけを直接飛ばしたりしない。
- 小説本文を日本漫画のページ脚本へ落とすときは `novel-to-manga-script` を使う。正本は小説本文（`page-handoff-v3`）。1ページは2〜4コマ。骨格はカタログから選び、隣接ページで同じ骨格を続けない。コマなしの読み物脚本は出さない。脚本を保存したら確認を待ち、依頼が画像化を含むときは承認後に `nai-v5-prompt-designer` へ渡す。縦スクロールWEBTOON連作の画像化はしない。R18の4列Word指示書は `erotic-scenario-converter`（導入済みなら）。
- 小説本文からセリフ付きの1枚イラスト（コマ割りなし、フキダシ1〜2）を出すときは `novel-to-dialogue-illust` を使う。正本は同Skill。ブリーフを保存したら確認を待ち、依頼が画像化を含むときは承認後に `nai-v5-prompt-designer` へ渡す。漫画ページは `novel-to-manga-script`。無言の挿絵1枚は `nai-v5-prompt-designer`。
- NovelAI のプロンプトは `nai-v5-prompt-designer` を使う。1生成＝1ページ（挿絵、セリフ付き1枚絵、または英語タグでコマ割りした漫画ページ。セリフだけ日本語）。漫画ページは `Layout_Skeletons.md` の階層英語とピン。二次元フィクションに限り、実写・実在人物は扱わない。体位語彙は同Skillの `R18_2D_Pose_Play_Lexicon.md`。ユーザーが特定キャラのイメージを指名したら `Character_Tag_Lookup.md`（辞書は `user-provided/`、配布外）。仕様の確定／未確定は `NAI_V5_Current_Spec.md`。出力文法は `Output_Contract.md`。規則は `Rules.md`。生成まで頼まれたときは、タグを書いて各ページを1回生成して終わる（R-API-07）。プロンプトだけの依頼は、Markdown を保存して承認を待つ（R-API-06）。既存PNGを残す依頼では `--out-dir` で新フォルダ。手順は同Skillの `references/API_Generate.md`。生成結果の確認と、同じプロンプトの3回出力は、ユーザーが明示したときだけ `references/Review_And_Regen.md` に従う（R-API-07）。`artist:` は今回の依頼が明示したときだけ。トークンはチャットに貼らない。ブラウザ自動化はしない。WEBTOON連作の画像化は対象外。確認ゲートは小説の連続執筆モードより優先する。
- 投稿サイトの傾向に合わせた企画・展開・キャラクター設計では、`novel-plot-advisor` が時点付きの市場情報を読者への約束へ翻訳し、`work/plot.md` の投稿戦略ブリーフ、キャラシート、シーンカードへ段階的に引き渡す。流行語を本文へ直接混ぜず、作品の不変コアを短期ランキングに追従させない。
- ユーザーが特定スキルを指定した場合は、そのスキルを優先する。
- 主要ワークフローは自然文またはSkillの明示指定（`/long-novel-orchestrator`、`/validate-episode`、`/novel-plot-advisor`、`/novel-worldbuilding-advisor`、`/nai-v5-prompt-designer`、`/novel-to-manga-script`、`/novel-to-dialogue-illust`）で起動する。

## 連続執筆モード

ユーザーが複数話の連続執筆を依頼した場合（例：`第14話から第23話まで書いて`）、指定範囲を完走するまでユーザー確認では停止しない。**確認の要否と保留の扱いは本節を正本とし、各スキルは再掲せず参照する。** 各話の完了の定義、3段バリデーション、アーク境界監査は通常と同一であり、連続実行を理由に省略しない。

0. シェル操作は「シェル実行の規約」に従う。連続執筆中の確認停止は完走を妨げるため、同節を特に厳守する。
1. 正典を変える補完が必要になったら、まず正典を変えない保守的な代替で回避する。
2. 回避できない場合は暫定判断を採用して続行し、`work/continuity/pending-decisions.md`（無ければ新規作成、append-only）へ「ID・話数・論点・採った暫定判断・影響した本文と台帳・却下した代替案」を記録する。暫定判断に由来する canon-log への追記には「（暫定：PD-\<番号\>）」を付す。
3. 主要人物の生死、世界法則の破壊、主要筋の不可逆な変更に踏み込む判断だけは連続実行を停止し、完成済みの話と停止理由を報告する。
4. 完走後または停止時に、保留判断の全件を結論から報告し、ユーザーの裁定を受けて暫定表記を確定するか該当話を改稿する。裁定は該当行の裁定欄へ追記し、他の欄は書き換えない。

## 読み込み戦略

巨大なコンテキストへ全資料を無差別に投入しない。毎話、次の順で必要部分だけを読む。**この順序は本ファイルを正本とし、各スキルは再掲せず参照する。**

1. `work/continuity/current-state.md` — 直前話終了時点の物語状態
2. `work/scene-cards/ep<NNN>.md` — 今回達成する局所目標
3. `work/pov-plan.md` — 該当話の割当行と、登場人物に関わる情報格差の行だけ
4. 当該場面に登場する `work/character-sheet-*.md`
5. `work/style-samples.md` の基調と、当該視点人物のサンプル
6. `work/plot.md` の現在アークと前後3話
7. `world-bible/00-INDEX.md` が指定する必要な正典だけ
8. 前話末尾の1場面
9. 地の文を書く・言い換える直前は `guidelines/02-narrative-craft.md` §2-8。台詞を書く・短くする話では同 §4-10。表現の採否で迷う箇所だけ `guidelines/05-ai-guardrails.md` §3-4

話数に比例して育つ台帳は全文を読まない。`world-bible/log/canon-log.md` は直近3話分の節と今回の題材に関わる語の検索結果だけ、`world-bible/core/08-timeline.md §3` は直近数行だけを読む。生きている事実の正本は `current-state` であり、canon-log は確定記録のアーカイブとする。

全文確認が必要なのは、アーク境界、総合診断、設定変更、重大な矛盾の疑いがある場合だけとする。アーク境界では逆に読み込みを絞らない。話をまたいで蓄積したずれは小分けに読むと見えないため、総量が収まる限り全話を一度に読んで横断照合する（判断基準は `long-novel-orchestrator` のアーク境界監査）。

## 長編の状態管理

事実を本文から毎回推測し直さない。以下を正本として分離する。

- 不変設定：`world-bible/core/`
- 必要時参照設定：`world-bible/ondemand/`
- 確定事項：`world-bible/log/canon-log.md`
- 時系列：`world-bible/core/08-timeline.md`
- 誰が何を知るか：`work/pov-plan.md`
- この作品の声：`work/style-samples.md`（確定本文から抜いた凍結サンプル）
- 現在の局所状態：`work/continuity/current-state.md`
- 話ごとの差分：`work/continuity/episodes/ep<NNN>.md`
- アーク境界の監査：`work/continuity/checkpoints/`

台帳は「追加された事実」「変化した関係」「負傷・所持品・位置」「未回収の約束」「新たに知った人物」を具体的に記録する。「物語が進んだ」のような抽象要約は禁止する。

## 執筆規則

本文の規則は `guidelines/` が正本であり、この節は再掲しない。入口は `guidelines/00-overview.md`。

- 表記は `guidelines/01-writing-rules.md`
- 視点・地の文・台詞は `guidelines/02-narrative-craft.md`。地の文を書く・言い換える直前は §2-8。台詞の生成・追加・短縮・吹き出し分割・画像プロンプトへの転記の直前に §4-10。対比例が必要なら `guidelines/07-dialogue-examples.md`
- 人物・世界は `guidelines/03-character-and-world.md` とキャラシート・正典
- 構造は `guidelines/04-structure-and-plot.md`
- 表現の採否は `guidelines/05-ai-guardrails.md` §3-4・§3-5。回数・主語・比喩の本数の割当は本ファイルに置かない
- 確認範囲と終了条件は `guidelines/06-revision-checklist.md`
- 診断は `ai-novel-detector`、文章の修正は `humanize-ai-writing`。小さな直接改稿に診断の先行を義務づけない
- 長編では各場面の開始時と終了時で状態を一つ以上変える。誤字で人間らしさを作らない

## 配置

- 永続的なリポジトリ指示：`AGENTS.md`
- 再利用可能な執筆・診断ワークフロー：`.agents/skills/`
- プロジェクト固有設定：`.grok/config.toml`
- 作品データ：`work/`
- 世界観正典：`world-bible/`

新しいスキルを追加・変更した場合は、`SKILL.md` だけでなく同じスキル配下の `references/`、`examples/`、`scripts/` も一体として扱う。

Skillのフロントマターは Grok の発見と起動用である。必須は `name`、`description`（何をするか／しないか）、`when-to-use`（自然文の引き金と `/skill-name`）。スラッシュ補完が要るSkillは `argument-hint`。一覧表示用の短い説明は `metadata.short-description`。`SKILL.md` 本体は手順と、いつどの参照を読むかだけに留め、詳細は `references/` へ置く。

## 推論と出力

- 設計・整合性監査・大規模改稿では高い推論強度を使う。逆に、機械検査の実行、台帳への転記、単一ファイルの表記修正は低い強度で足りる。
- 本文は内部設計をそのまま説明せず、小説本文だけを出力ファイルへ書く。
- 長い話を一度に生成して後半を惰性化させない。場面単位で設計確認し、話全体のリズムを最後に統合する。
- 不足情報が軽微なら、既存正典と作品トーンから保守的に補完して進め、補完内容を状態差分へ記録する。
- 正典を変える重大な補完だけは、本文確定前にユーザーへ確認する。連続執筆モード中の扱いは「連続執筆モード」の節を正本とする。

## 委譲

- 本文の生成と台帳の更新は、資料を読み込んだ文脈でそのまま行う。状態を持たないサブエージェントに書かせない。長編の破綻は、資料を見ていない書き手が本文を足すところから始まる。
- 委譲してよいのは、独立して完結する調査に限る。過去話を横断する語句・矛盾の検索、外部情報の収集、複数ファイルにまたがる出現箇所の洗い出しなど。
- 自分の仕事を再確認させるためにサブエージェントを立てない。表記は `check.sh`、台帳は `state_check.py`、文体診断は `ai-novel-detector`、改稿は `humanize-ai-writing` が受け持つ。

## シェル実行の規約

シェル操作は、Grok のサンドボックスと承認ポリシーを保ったまま、意図しない上書きや承認待ちの連鎖を避ける。

- ファイルの作成・追記・変更は `search_replace` または `write` を使う。シェルのリダイレクト書込（`>`、`>>`）やヒアドキュメントで代用しない。
- 検索は専用の `grep` ツール（ripgrep）を優先する。本文・資料は必要な範囲だけ読み、巨大なファイルを無差別に出力しない。
- 検査コマンドと Python スクリプトは `run_terminal_command` で実行する。インタプリタは `python`、`py -3`、`python3` の順で試し、パスに `WindowsApps` を含むものを使わない。Bash スクリプトは `bash scripts/<name>.sh` で起動する（`./scripts/` は使わない）。Python は 3.11 以降。Windows ネイティブで GNU grep がない場合は WSL または Git Bash を使う。
- 一時ファイルは `/tmp` に置かず、作業ディレクトリまたは `work/` 配下を使う。
- 読み取りと変更を一つの複合コマンドへ混ぜない。破壊的操作は対象の絶対パスを確認し、ユーザーの依頼範囲内かを確かめる。
- 終了コードの確認に別のコマンドを足さず、実行結果から判定する。

新しい検査スクリプトを `scripts/` へ追加したら、検証コマンド、`scripts/audit-repo.py`、READMEの参照を同じ変更で更新する。

## 検証コマンド

`bash`、`python3`、GNU grep が使えるシェルで、本文確定後に3段バリデーションを行う。

```bash
bash scripts/check.sh --strict work/drafts/episode<NNN>.txt
python3 scripts/normalize_blanklines.py --check work/drafts/episode<NNN>.txt
bash scripts/chars.sh work/drafts/episode<NNN>.txt
python3 scripts/repeat_check.py work/drafts/episode<NNN>.txt
python3 scripts/vocab_check.py work/drafts/episode<NNN>.txt
python3 scripts/cliche_check.py work/drafts/episode<NNN>.txt
python3 scripts/combat_terms_check.py work/drafts/episode<NNN>.txt
python3 scripts/state_check.py --strict
```

`repeat_check.py`（話またぎの逐語一致）、`vocab_check.py`（職能語・口癖の飽和）、`cliche_check.py`（直訳クリシェ・感情ぼかし・圧縮癖のクラスタ）の出力は警告候補である。採否は `guidelines/05-ai-guardrails.md` §3-4、逐語は `guidelines/02-narrative-craft.md` §5-3、職能語は同 §2-7。機能する反復は残し、再警告を避けるときだけ allowlist／watchlist へ理由を書く。警告を消すための登録や、意味を変える変奏はしない。警告の件数は完成条件にしない。

`combat_terms_check.py` は戦闘・装備の部位、収納状態、操作、助数詞の高確度事故を検出する。戦闘・装備が登場する話では `check-combat-equipment-terms` の目視7軸と併用する。装備が一切出ない話はスクリプト結果が空でもよい。

`state_check.py` は台帳側の整合を照合する。本文ファイルと状態差分ファイルの対応、作中日時、現在状態、日付の正本（`world-bible/core/08-timeline.md §3`）との突合、伏線台帳、情報格差の事実IDを検査し、`[NG]` は必ず直し、`[警告]` は作品意図に照らして採否を決める。

`state_check.py` が見るのは台帳どうしの機械的な対応だけである。本文の出来事と状態差分の意味的な対応、canon-log の確定事項との整合、人物ごとの位置・所持品・負傷の連続は本文を読んで判断する必要があり、`validate-episode` と `guidelines/06-revision-checklist.md` の目視手順が受け持つ。機械検査の合格をもって、これらを照合済みとして報告しない。

`scripts/check.sh` は PCRE（`grep -P`）を使うため GNU grep が必要である。macOS標準grepは非対応なので、GNU grepを導入するか WSL／Linux で検査する。検査不能を合格として扱わない。

規約・スキル・テンプレート・スクリプトを変更したら、一括監査する。

```bash
python3 scripts/audit-repo.py
```

検出ルール（`guidelines/` や `scripts/check.sh`）を変更したときは、固定データによる回帰テストも実行する。期待件数は `tests/expectations.tsv` にあり、ルールを意図的に変えたときは期待値も一緒に更新する。

```bash
bash scripts/eval.sh
```

## 変更時の原則

- 既存のユーザー変更を上書きしない。
- `work/` と `world-bible/` の正典変更は、本文との整合を同じターンで確認する。
- append-only指定の台帳は途中行を黙って書き換えない。
- スクリプトやスキルを変更したら、参照パスとREADMEも確認する。

## 応答の形

- 報告は結論から書く。最初の一文で「何が完成したか」「何が残っているか」を答え、詳細はその後に置く。
- 作業中の実況は、重要な発見と方針転換のときだけにする。手順の逐一報告はしない。
- 台帳と状態差分には具体的な事実だけを書く。要約文、前置き、定型の締めを足さない。
- 直前の発言の訂正は、ユーザーの判断や本文が変わるときだけ明示する。変わらない言い直しは黙って直す。
