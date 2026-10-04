# 取り扱いマニュアル — 長編小説執筆リポジトリ

DSH・Gemma・Qwen・ローカル Krea 2 によるセッション単位の漫画制作と、専用の吹き出し・文字入力ツールは [manga-studio/README.md](manga-studio/README.md) を参照する。本マニュアルの以降の節は従来の小説執筆環境を扱う。

このファイルは、本パッケージを受け取ったGrokと利用者の双方に向けた運用マニュアルである。Grokは `AGENTS.md` を自動で読み、本ファイルはセットアップと運用の詳細が必要なときに参照する。

使い方の本筋は次の3節である。どの経路かを決めるときは [§4 作業の地図](#4-作業の地図) 、本文を書くときは [§7 小説の書き方](#7-小説の書き方) 、できあがった本文をPDFや漫画にするときは [§8 小説の加工](#8-小説の加工) を読む。

規約が競合した場合は、利用者の明示指示を最優先する。領域ごとの正本は次のとおり。

- 本文の表記・台詞・表現の採否・確認範囲：`guidelines/`（`AGENTS.md` は上書きしない）
- 長編の配置・状態・完了手順・シェル：`AGENTS.md`
- 各スキルは担当手順だけを持ち、同じ規則を複製しない
- 本マニュアルは運用の案内であり、上記を上書きしない

目次：

- [1. Grok Build](#1-grok-build)
- [2. NovelAI 公式API](#2-novelai-公式api)
- [3. このリポジトリは何か](#3-このリポジトリは何か)
- [4. 作業の地図](#4-作業の地図)
- [5. 最初の1回だけ行うセットアップ](#5-最初の1回だけ行うセットアップ)
- [6. ディレクトリ構成と正本の一覧](#6-ディレクトリ構成と正本の一覧)
- [7. 小説の書き方](#7-小説の書き方)
- [8. 小説の加工](#8-小説の加工)
- [9. スキルの一覧](#9-スキルの一覧)
- [10. 検証コマンドと結果の読み方](#10-検証コマンドと結果の読み方)
- [11. やってはいけないこと](#11-やってはいけないこと)
- [12. トラブルシューティング](#12-トラブルシューティング)
- [13. 用語](#13-用語)

---

## 1. Grok Build

本パッケージは **Grok Build** 上で動く。Grok Build は、ターミナルで動くAIアシスタント（TUI）であり、リポジトリを読み、ファイルを編集し、シェルを実行し、Skill（再利用可能な手順書）に従って作業する。CLIの起動コマンドは `grok` である。

小説本文はチャットの返信欄へ出さず、リポジトリ内のファイルへ保存する。Grok Build は「会話相手」であると同時に、このディレクトリを作業場として使う執筆エージェントである。

### 1-1. インストール

macOS / Linux / Windows（Git Bash）:

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
grok --version
```

Windows（PowerShell）:

```powershell
irm https://x.ai/cli/install.ps1 | iex
grok --version
```

PowerShellインストーラは `%USERPROFILE%\.grok\bin` をユーザーPATHへ入れる。更新は `grok update`。

### 1-2. 認証

初回起動でブラウザが開き、grok.com でサインインする。資格情報は `~/.grok/auth.json` に保存され、以後のセッションで再利用される。

```bash
grok
grok login    # アカウントを切り替える・再認証する
grok logout   # キャッシュした資格情報を消す
```

ブラウザが使えない環境では、[console.x.ai](https://console.x.ai) のAPIキーを環境変数へ置く。

```bash
export XAI_API_KEY="xai-..."
grok
```

`auth.json` と NovelAI の `.env` は別物である。どちらもチャット、Issue、コミットへ貼らない。

### 1-3. このリポジトリでの起動

展開したディレクトリ（`AGENTS.md` がある場所）で起動する。推奨はワークスペース制限付きサンドボックス。

```bash
grok --sandbox workspace
```

| 起動例 | 意味 |
|---|---|
| `grok --sandbox workspace` | 読み取りは広く、書き込みは作業ディレクトリと `~/.grok/` と一時領域に限る。日常の推奨 |
| `grok` | サンドボックスなし。既定 |
| `grok --cwd <このディレクトリ>` | 作業ディレクトリを明示する |
| `grok -c` | 直近セッションを続きから再開する |
| `/new` | 会話を捨てて新しいセッションにする |

`workspace` サンドボックスでも、検査スクリプトや NovelAI ドライランは動く。実画像生成は外部APIへの送信なので、ネットワークとトークンが要る。

### 1-4. 画面の使い方

- **スクロールバック** — 会話、思考、ファイル編集、コマンド実行が出る。
- **プロンプト** — 下端の入力欄。`Enter` で送信。
- **`Tab`** — 入力欄とスクロールバックのフォーカス切替。
- **`Esc`** — 実行中のターンを中断する。
- **`@ファイルパス`** — ファイルや行範囲を添付する。ディレクトリも指定できる。
- **`/`** — スラッシュコマンドと、同梱Skillの起動メニュー。

権限の確認が出たら、その操作だけ承認するか、セッション内で常時承認へ切り替えられる。`Ctrl+O` または `/always-approve`。本リポジトリの `.grok/config.toml` は、検査スクリプトと NovelAI のドライランを毎回確認しなくてよいよう `permission.allow` に載せている。`rm -rf` は deny のままである。

### 1-5. このリポジトリとGrok Buildの結びつき

| 部品 | Grok Buildでの役割 |
|---|---|
| `AGENTS.md` | セッション開始時に自動で読む。配置・状態・完了手順・シェルの正本 |
| `.agents/skills/` | Skillの発見場所。自然文でも `/skill-name` でも起動する |
| `.grok/config.toml` | 検査コマンドの許可と、破壊的操作の拒否 |
| `guidelines/` | 表記・台詞・表現の採否・確認範囲の正本。Skillが必要時に読む |
| `work/` / `world-bible/` | 作品の正本。Grokはここへ本文と台帳を書く |

Skillは `SKILL.md` を持つディレクトリである。Grokは `description` と `when-to-use` を見て、今の依頼に合う手順だけを読む。スラッシュ補完のヒントは `argument-hint`。Skillが見つからないときは新しいセッションを始めるか、`grok inspect` で `.agents/skills/<名前>/SKILL.md` の有無を確認する。

自然文の例:

```text
第1話を書いて
第12話から第15話まで、1話ずつ状態を確定しながら書いて
この本文を検査して
```

明示指定の例:

```text
/long-novel-orchestrator 第1話
/validate-episode 第12話を違反ゼロまで修正して
/nai-v5-prompt-designer
```

Skillを追加・変更したのにメニューに出ない場合は、セッションを新しくする。

### 1-6. 執筆に使う操作の目安

- 長い会話で文脈が膨らんだら `/compact` で履歴を圧縮する。作品の正本はファイル側にあり、チャット履歴ではない。
- 本文・正典・台帳の正はディスク上のファイルである。チャット上の要約を正本にしない。
- 検査はGrokに実行させてよい。結果の `[NG]` は必ず直し、`[警告]` は本文を読んで採否を決める。
- NovelAIのトークン、`.env` の中身、`pst-` で始まる文字列をGrokへ貼らない。「トークンがあるか」だけ確認させる。

---

## 2. NovelAI 公式API

小説の執筆だけなら NovelAI は不要である。挿絵・漫画ページを公式APIで画像化するときだけ使う。ブラウザを自動操作しない。実装は `scripts/nai_generate.py`（標準ライブラリのみ）。

プロンプトの組み立ては Skill、送信はスクリプト、トークンは利用者が自分の環境へ置く、という分離になっている。配布zipにトークンは含まれない。NovelAIの利用は、NovelAIの利用規約およびコンテンツポリシーに従う。本パッケージはそれらの許諾を含まない。

### 2-1. 使い分け

| 目的 | Skill | 出力 |
|---|---|---|
| V5で挿絵1枚、セリフ付き1枚絵、または英語タグでコマ割りした漫画1ページ（セリフだけ日本語） | `nai-v5-prompt-designer` | Markdown（公式APIが読む形） |
| 小説を日本漫画のページ脚本へ | `novel-to-manga-script` | 1ページ2〜4コマの脚本。承認後に V5 へ渡せる |
| 小説をセリフ付き1枚絵へ | `novel-to-dialogue-illust` | コマ割りなし、フキダシ1〜2の作画ブリーフ。承認後に V5 へ渡せる |

1生成＝1ページである。縦スクロールWEBTOON連作の画像化は対象外。精密参照（Precise Reference）と NovelAIポーションは、V5ローンチ時点では未対応なので指示に出さない。

画風の `artist:` は利用者が指定したときだけ付ける。未指定の既定は次の画風タグである。

```text
anime illustration, official art, soft shading, clean lineart, high complexity, depthness, very aesthetic, masterpiece
```

### 2-2. 契約と費用の目安

Opus契約が必要。通常解像度（832×1216）・**28ステップ以下**・同時1枚は Anlas 0（充電池）。本Skillの漫画既定はステップ23、プロンプトガイダンス5、Euler Ancestral。大サイズ、28超、同時複数は Anlas を消費する。

### 2-3. トークンの置き方

1. NovelAI にログインする。
2. アカウント設定（画面左上付近の歯車 → Account）を開く。
3. **Get Persistent API Token**（または同等の「永続APIトークン」）を発行する。
4. 値は `pst-` で始まる。ログイン用メール／パスワードでもセッションCookieでもない。パスワードマネージャへ保存する。
5. リポジトリ直下へ雛形をコピーする。

```bash
cp templates/nai-api.env.example .env
```

`.env` の `pst-ここに貼る` を自分のトークンに差し替え、権限を絞る。

```bash
chmod 600 .env
```

先頭8文字だけ見て、`pst-` であることだけ確認する。値は他人に見せない。

```bash
head -c 8 .env; echo
```

`.env` は `.gitignore` 済みである。`git add .env` しない。チャットに貼らない。Grokに「中身を表示して」と頼んでも拒否する。環境変数でも可。

```bash
export NOVELAI_API_TOKEN='pst-……'
```

### 2-4. プロンプトを書いてから画像にする順

1. `/nai-v5-prompt-designer`（または漫画脚本の承認後）で Markdown を `work/drafts/<名前>.md` へ保存する。
2. プロンプトだけの依頼では、**このターンでは実生成しない。** パスとページ数を報告し、利用者の承認を待つ。生成まで頼まれたときは、タグを保存したあと各ページを1回生成する。小説の連続執筆モードは、プロンプトだけの確認ゲートを消さない。
3. トークンなしでパースだけ確認する（承認前でも可）。

```bash
python3 scripts/nai_generate.py --dry-run work/drafts/<prompt>.md
```

成功すると、モデル・解像度・ステップ・ページ数、各ページの Character 数と位置の出所（`table` / `prose` / `default`）が出る。契約違反は非ゼロ終了。JSONは `work/generated/<stem>-dry-run.json`。`model` が `nai-diffusion-5-full`、`ucPreset` が `4`（指定なし）、`qualityToggle` が `false` なら設定欄の読み取りは合っている。

4. 「OK」「生成して」などで承認したら、依頼されたページを1回ずつ生成する。ページ指定が無ければ全ページ。

```bash
python3 scripts/nai_generate.py --skip-existing work/drafts/<prompt>.md
```

保存先は `work/generated/<prompt>/page-01.png`（git 対象外）。保存できたら生成は終わる。PNGは開かない。

`--skip-existing` は既にある `page-NN.png` を飛ばす。途中で止めても続きから再開できる。連続送信の間隔は既定2秒（`--sleep 3` で伸ばせる）。既存フォルダを残す依頼では `--out-dir` に新しいフォルダを付ける。

特定ページだけ:

```bash
python3 scripts/nai_generate.py --page 8 --page 12 --page 13 work/drafts/<prompt>.md
```

### 2-5. 選別と再生成

利用者が「確認して」「選別」「問題ページだけ再生成」「3回出して」と明示したときだけ行う（R-API-07）。『生成して』だけでは入らない。脚本と違う画面は、現行の `page-NN.png` を残したまま最大3枚まで候補を足し、一番近い1枚を確定する。同じ系統の失敗が3枚続いたあとだけ、プロンプトを1軸直す。

```bash
python3 scripts/nai_generate.py --page 4 --count 3 --skip-existing work/drafts/<prompt>.md
python3 scripts/nai_adopt.py --stem <promptのstem> --page 4 --list
python3 scripts/nai_adopt.py --stem <promptのstem> --page 4 --take 2
```

`--count 1 --page N` は `page-NN.png` を上書きするので、再生成ループでは使わない。手順の正本は `.agents/skills/nai-v5-prompt-designer/references/Review_And_Regen.md`。

### 2-6. コマンド一覧

```text
python3 scripts/nai_generate.py [--dry-run] [--page N] [--count N] [--skip-existing]
    [--model ID] [--seed N] [--sleep 秒] [--timeout 秒] [--out-dir パス]
    <markdown>
```

| 引数 | 用途 |
|---|---|
| `--dry-run` | 送信しない。トークン不要 |
| `--page N` | ページ番号。複数回書いてよい |
| `--count N` | 各ページをN回。2以上なら `page-NN.png` を触らず `page-NN-1.png` 以降 |
| `--skip-existing` | 既存PNGを飛ばす |
| `--model` | 設定欄を上書き。既定 `nai-diffusion-5-full` |
| `--seed` | 再現用。省略時はAPI側の乱数 |
| `--out-dir` | 省略時 `work/generated/<markdownのstem>/` |

Grokへの頼み方:

| 依頼 | Grokの動き |
|---|---|
| 「この Markdown をドライランして」 | 実行してよい。トークンは使わない |
| 「ページ1を生成して」「OK、生成して」 | タグのあと、指定ページを1回ずつ保存して終わる。PNGの確認と3回出力はしない。`.env` がある前提。トークンは受け取らない |
| 「確認して」「選別」「問題ページだけ再生成」「3回出して」 | Review_And_Regen の手順（明示されたときだけ） |
| 「トークンを確認して」「`.env` の中身を表示して」 | 拒否する。存在するかどうかだけ見る |

### 2-7. よくある失敗

| 症状 | やること |
|---|---|
| `NOVELAI_API_TOKEN がありません` | `.env` がリポジトリ直下か。変数名の誤字 |
| 雛形のまま | `pst-ここに貼る` を本物へ |
| `API 401` | トークン失効。Account で再発行し `.env` を更新 |
| `API 402` / Anlas | 大サイズ・高ステップ・同時複数になっていないか。`--dry-run` の width/height/steps |
| `API 400` と model | `--model nai-diffusion-5-full` または `nai-diffusion-5-curated` |
| `API 429` | `--sleep` を伸ばす |
| 文字が出ない | Quality Tags 指定なし、`no text` が Base に無い。JSON 末尾に `Text:` |
| 黒帯キャプション | 引用を話者文の直後へ。長いコマ指示を短くする |
| 人が入れ替わる | `## 配置` 表を足す。ピンを15以上離す |

詳細は `.agents/skills/nai-v5-prompt-designer/references/API_Generate.md`。

---

## 3. このリポジトリは何か

三人称多元視点の日本語長編Web小説を、数十万字を超えても**設定・時系列・人物像・伏線・情報格差を破綻させずに**書き上げるための執筆環境である。

中心にある考え方は3つ。

1. **書く前に固定する** — 世界観、人物、視点、プロットを執筆前に確定し、本文から推測し直さない。
2. **正本を分離する** — 「誰が何を知っているか」「今どこで何を持っているか」を台帳ファイルで管理し、本文を読み返して再構築しない。
3. **書いた後に機械検査する** — 記号事故と定型化を検出スクリプトで潰し、文章のリズムと具体性は文脈判断で直す。

1リポジトリ＝1作品で運用する。複数作品を書く場合は、パッケージを作品ごとに展開する。

作業の入口は [§4](#4-作業の地図)。本文の経路は [§7](#7-小説の書き方)。できあがった本文のPDF化・漫画化は [§8](#8-小説の加工)。

成人向け制作（小説・脚本・NAIプロンプト）の登場人物は、架空の成人（日本法の18歳以上）に限る。既成キャラクターを性的文脈で扱うときは成人と定義し、原作設定には準拠させない。成人同士の合意・強制・非強制は文脈で判断する。拒否は未成年、実在人物、児童性的虐待、現実の犯罪手口の具体化に限る。安全条件の正本は `AGENTS.md`「成人向けの前提」。

---

## 4. 作業の地図

作業は大きく二つに分かれる。**本文を書く**ことと、**書けた本文を加工する**ことである。混ぜない。

```text
書く（§7）                              加工（§8）
─────────────────────────────         ─────────────────────────────
プロットから長編を書く                   挿絵付きPDFにする
イラストから短編を書く                   漫画脚本 → 漫画ページを生成する
相談してから設計する                     小説 → セリフ付き1枚絵
既存本文を検査・改稿する                 挿絵1枚だけ生成する
```

一次ソースが何かで、入口が決まる。

| 手元にあるもの | やりたいこと | 読む節 | 入口 |
|---|---|---|---|
| まだ本文がない。世界観や話の筋から作りたい | 長編Web小説 | [§7-1](#7-1-プロットから長編を書く) | `第1話を書いて` |
| 投稿先や読者への約束が決まっていない | 企画・世界観の壁打ちのあと長編へ | [§7-2](#7-2-企画世界観を相談してから書く) | `/novel-plot-advisor` または `/novel-worldbuilding-advisor` |
| 既存のイラストフォルダがある | 画像の行為をベースに挿絵付き短編を書く | [§7-3](#7-3-イラストから短編を書く) | `/illust-r18-novel` とフォルダ |
| すでに本文がある | 検査・改稿 | [§7-4](#7-4-既存本文を検査改稿する) | `/validate-episode` |
| 挿絵マーカー付きの本文と画像 | A5のPDFにまとめる | [§8-1](#8-1-挿絵付きpdfにする) | `/illust-novel-pdf` |
| 小説本文（マーカーは不要） | 日本漫画のページ脚本と画像 | [§8-2](#8-2-漫画脚本から漫画を生成する) | `/novel-to-manga-script` |
| 小説本文（マーカーは不要） | セリフ付き1枚絵 | [§8-3](#8-3-小説からセリフ付き1枚絵にする) | `/novel-to-dialogue-illust` |
| 1枚絵の指示だけ | NovelAIで挿絵1ページ | [§8-4](#8-4-挿絵1枚だけ生成する) | `/nai-v5-prompt-designer` |

混同しやすい点は次のとおり。

- **イラストから小説を書く**のは、フォルダ内の既存画像が一次ソースである。新しい絵は出さない。画像を本文の流れへ埋め込むのは [§8-1](#8-1-挿絵付きpdfにする) のPDF化である。
- **小説から漫画を生成する**のは、本文が一次ソースである。脚本を作り、NovelAIで**新しいページ画像**を出す。[§2](#2-novelai-公式api) のトークンが要る。既存フォルダの挿絵とは別経路である。
- 長編の1話と、画像起点の単独短編では、保存先と台帳の要否が違う。差は [§7](#7-小説の書き方) の比較表。

### このパッケージが持たないもの

- 作品本文、世界観正典、利用者の `.env`、参照画像。zipには入っていない。`init-work.sh` で空の骨組みだけ作る
- NovelAI の Persistent API Token。自分で発行して `.env` へ置く
- 縦スクロールWEBTOON連作の画像化
- NovelAI サイトのブラウザ自動操作
- 実在人物・写真・実写化。VTuberなどの二次元キャラクターは架空のキャラクターとして扱う
- 未成年の性的生成、児童性的虐待
- 現実の犯罪手口の具体化（監禁・薬物・拘束のhow-to）
- 第三者の著作物・商標・キャラクターの利用許諾。二次創作は各権利者のガイドラインに従う
- 相談Skill（plot / worldbuilding）の、執筆フローからの自動起動。利用者が明示したときだけ使う

---

## 5. 最初の1回だけ行うセットアップ

### 5-1. 環境を確認する

| 必要なもの | 用途 |
|---|---|
| Grok Build（CLI / TUI） | 執筆・診断・Skill実行 |
| bash | `scripts/*.sh` |
| Python 3.11以降 | `scripts/*.py` |
| GNU grep | `scripts/check.sh` のPCRE検査 |

```bash
grok --version
bash --version
python3 --version
echo "あ" | grep -P 'あ'
```

最後のコマンドが `あ` を出力しなければ、`scripts/check.sh` は動作しない。macOS標準の grep は `-P`（PCRE）に対応していないため、GNU grep を導入するか、WSL または Linux で検査する。Windowsでは Git Bash か WSL を使う。**検査できない状態を「合格」として扱ってはならない。**

NovelAI を使う場合の追加条件は §2。セットアップ時点では `.env` を作らなくてよい。

### 5-2. 展開する

zip と同梱のセットアップ指示がある場合は、空のディレクトリへ両方を置き、指示文をGrokへ貼る。手動なら次のとおり。

```bash
python3 -m zipfile -e novel-Standard-template-grok.zip .
cd novel-Standard
```

同名ディレクトリが既にあるときは上書きしない。

### 5-3. Grokを起動する

```bash
grok --sandbox workspace
```

`AGENTS.md` と `.agents/skills/` は自動で読み込まれる。プロジェクト設定は `.grok/config.toml` を参照する。

### 5-4. 実行権限を付ける

```bash
chmod +x scripts/*.sh
```

### 5-5. 作業ディレクトリを生成する

```bash
bash scripts/init-work.sh
```

`work/` と `world-bible/` の骨組みを、`templates/` を元に生成する。**既存ファイルは上書きしない**ので、再実行しても安全である。

### 5-6. 導入を検証する

```bash
python3 scripts/audit-repo.py
python3 scripts/state_check.py
```

`audit-repo.py` が `FAIL 0` なら導入完了。1件でも FAIL があれば、その内容を利用者へ報告し、原因を解消するまで執筆を始めない。初期化直後の `state_check.py` は、本文も状態差分もないため検査省略の情報行だけを出す。これは正常である。

---

## 6. ディレクトリ構成と正本の一覧

```text
AGENTS.md            # 最優先の永続規約。Grokが自動で読む
MANUAL.md            # 本ファイル。運用手順の入口
README.md            # 人間向けの短い導入
LICENSE              # 利用条件
.agents/skills/      # 執筆・診断・相談ワークフロー
.grok/config.toml    # permission 等のプロジェクト設定
guidelines/          # 正書法・視点・構造・改稿の詳細規約
templates/           # 作品設計と状態管理の雛形
scripts/             # 初期化・検査・NovelAI生成・PDF化
tests/               # 検査ルールの回帰フィクスチャ
work/                # 作品データ（init-work.shが生成）
world-bible/         # 世界観正典（init-work.shが生成）
user-provided/       # 外部ファイルの一時受け渡し（中身はgit対象外）
```

`guidelines/` の分担:

| ファイル | 内容 |
|---|---|
| `00-overview.md` | 運用の入口と読み分け |
| `01-writing-rules.md` | 記号・正書法 |
| `02-narrative-craft.md` | 視点・地の文・台詞（地の文の骨格は §2-8、台詞の生成・短縮の直前は §4-10） |
| `03-character-and-world.md` | 人物と世界観 |
| `04-structure-and-plot.md` | 構造・プロット |
| `05-ai-guardrails.md` | 表現の採否（§3-4・§3-5） |
| `06-revision-checklist.md` | 確認範囲と終了条件（G-3） |
| `07-dialogue-examples.md` | 台詞の対比例（必要時だけ） |

「事実がどこに書いてあるか」は次の表を正本とする。**本文から推測し直さない。**

| 知りたいこと | 正本ファイル |
|---|---|
| 変わらない世界設定 | `world-bible/core/` |
| 必要なときだけ見る設定 | `world-bible/ondemand/` |
| 本文で確定した事実 | `world-bible/log/canon-log.md` |
| 作中の日付と出来事の順序 | `world-bible/core/08-timeline.md` |
| 誰が何を知っているか | `work/pov-plan.md` の情報格差マトリクス |
| どの場面を誰の視点で書くか | `work/pov-plan.md` の視点割当表 |
| 人物の一人称・呼称・語尾・癖 | `work/character-sheet-<名前>.md` |
| この作品の声（文体の凍結サンプル） | `work/style-samples.md` |
| アーク構成・伏線台帳・目安字数 | `work/plot.md` |
| 今回の話で達成すること | `work/scene-cards/ep<NNN>.md` |
| 直前話の終了時点の状態 | `work/continuity/current-state.md` |
| 話ごとの状態差分 | `work/continuity/episodes/ep<NNN>.md` |
| 本文 | `work/drafts/episode<NNN>.txt` |
| NAIプロンプト | `work/drafts/<名前>.md` |
| 生成画像 | `work/generated/`（git 対象外） |

`user-provided/` は、挿絵ソース、画風参照、キャラクタータグ辞書など、外部から持ち込むファイルの置き場である。配布zipには `.gitkeep` だけ入る。

---

## 7. 小説の書き方

本文を新しく書く経路は、一次ソースで分かれる。加工（PDF・漫画）は [§8](#8-小説の加工) であり、ここには含めない。

| | プロットから長編 | イラストから短編 |
|---|---|---|
| 一次ソース | 世界観・人物・プロット | 画像フォルダに描かれた行為と順 |
| 入口 | `第N話を書いて` / `/long-novel-orchestrator` | `/illust-r18-novel` とフォルダ |
| 設計の正本 | `world-bible/`、`plot`、`pov-plan`、scene-card | 画像列。橋渡しは最小 |
| 本文の置き場 | `work/drafts/episode<NNN>.txt` | `work/drafts/illust-r18-<slug>.txt` など依頼のパス |
| 挿絵 | 本文にはまだ無い。後から漫画化するなら §8-2 | 本文に `［挿絵：…］` を置く。PDF化は §8-1 |
| 台帳・時系列 | 必須 | 単独短編では不要。長編に載せるときだけ scene-card 経由 |
| 検証 | `validate-episode` と `state_check.py` | `validate-episode` 修正モード。`state_check.py` は長編のみ |
| 向く仕事 | 話を重ねるWeb小説 | 既存イラストを挿絵にした官能短編 |

成人向け場面の描写は、どちらの経路でも `novel-write-r18` が担う。地の文の部位・行為の言い換えも同Skill。

### 7-1. プロットから長編を書く

標準の経路である。セットアップ（[§5](#5-最初の1回だけ行うセットアップ)）のあと、資料を凍結してから1話ずつ書く。

#### 執筆前に凍結する設計

新作では、次の順に `templates/` を元に作品資料を作り、**執筆前に凍結**する。凍結後に直す場合は、別の改訂履歴を作らず、影響する本文・正典・時系列・状態台帳を同じ作業で同期する。

1. **`world-bible/`** — 世界法則、地理、勢力、暦、技術水準。`00-INDEX.md` に「どの話でどれを読むか」を書く。
2. **`work/character-sheet-<名前>.md`** — 視点人物と主要人物。台詞の一人称・二人称・呼称・語尾・禁則語、視点フィルタまで埋める。雛形は `templates/character-sheet.md`。
3. **`work/pov-plan.md`** — 場面ごとの視点割当と、事実ごとの情報格差マトリクス。三人称多元視点の中枢。
4. **`work/plot.md`** — アーク、伏線台帳、キャラアーク、作品基本情報（目安字数、場面転換記号）。
5. **`work/scene-cards/ep<NNN>.md`** — 1話単位の設計。書く直前に作る。
6. **`work/style-samples.md`** — 第3話まで書けた時点で、**実際に書けた本文から抜き出して**埋める。

資料が不足したまま本文を書き始めない。軽微な不足は既存資料から保守的に補い、補完内容を状態差分へ記録する。**人物の根幹、世界法則、主要筋を変える判断だけは、本文を確定する前に利用者へ確認する。**

#### 1話の標準手順

利用者が「第12話を書いて」と依頼した場合、Grokは次のように動く。

0. 入口は `long-novel-orchestrator`。複数話でも1話ずつ完了させ、前の話が完了するまで次へ進まない。
1. 必要な資料だけを次の順で読む。`current-state` → scene-card → `pov-plan` → 登場人物のシート → `style-samples` → 現在アーク前後3話 → 必要な正典 → 前話末尾1場面。地の文を書く・言い換える直前は `guidelines/02-narrative-craft.md` §2-8。台詞を書く・短くする話では同 §4-10。表現の採否で迷う箇所だけ `guidelines/05-ai-guardrails.md` §3-4。アーク境界では絞らない。
2. 今回の制約を資料から**逐語引用**する。要約や記憶で代替しない。食い違いがあれば本文を書かずに報告する。
3. `narrative-style-web-novel`（地の文主体／会話主体／混合）で書き、`work/drafts/episode<NNN>.txt` へ**小説本文だけ**を保存する。成人向け場面は `novel-write-r18`。
4. `validate-episode` の修正モードで検査・診断・改稿する。戦闘が出る話では `check-combat-equipment-terms` を併用する。
5. 確定本文だけを根拠に台帳を更新し、`python3 scripts/state_check.py --strict` を通す。

守る規則の要点（詳細は `guidelines/`）：1場面1視点。視点人物が知らない事実を地の文へ書かない。地の文の骨格は `guidelines/02-narrative-craft.md` §2-8。地の文の固有名は呼び捨て。具体物と身体反応を優先する。各場面で開始時と終了時の状態を変える。

連続執筆（「第14話から第23話まで書いて」）では、指定範囲を完走するまで確認では停止しない。各話の完了定義は省略しない。主要人物の生死、世界法則の破壊、主要筋の不可逆な変更だけは停止する。NovelAI の確認ゲートは、この連続実行より優先する。

第3話まで書けたら `work/style-samples.md` を確定本文から埋める。アーク境界では横断監査を優先する。

### 7-2. 企画・世界観を相談してから書く

長編の入口の前に、企画だけを壁打ちできる。**相談Skillは執筆フローから自動では呼ばない。** 明示したときだけ使う。相談の結果は `work/plot.md` や正典へ渡し、本文は [§7-1](#7-1-プロットから長編を書く) で書く。

| 相談したいこと | 頼み方 |
|---|---|
| 投稿サイト、読者への約束、序盤3話 | `/novel-plot-advisor 序盤3話の読者への約束を詰めたい` |
| 通貨、旅程、文化、風土 | `/novel-worldbuilding-advisor 大陸間交易の通貨を設計したい` |
| 世界観とプロットをまとめて設計 | `世界観とプロットを設計したい` |

流行語を本文へ直接混ぜない。作品の核を短期ランキングに追従させない。

### 7-3. イラストから短編を書く

既存の画像フォルダが一次ソースである。画像に描かれた行為・順・体勢をベースに、挿絵マーカー付きの官能短編を書く。**NovelAIで新しい絵は出さない。** 画像をPDFへ埋め込むのは [§8-1](#8-1-挿絵付きpdfにする)。

1. 画像を `user-provided/` 以下など、パスが分かる場所へ置く。
2. `/illust-r18-novel` とフォルダを指定する。入口が抜粋・順序化し、描写は `novel-write-r18` へ渡す。
3. ファイル先頭に `※※※` の注意書き（フィクション・非実在・全員成人）。各挿絵の直前に `［挿絵：ファイル名］`。
4. 本文保存後に `validate-episode` の修正モードを通す。これなしに完成としない。
5. 長編の1話として載せる依頼なら、scene-card 化のあと `write-episode` へ渡す。以後は [§7-1](#7-1-プロットから長編を書く) の台帳更新に従う。

画像に無い行為へ差し替えない。体格差は画像と依頼の指定に従い、均さない。

### 7-4. 既存本文を検査・改稿する

すでに本文があるときの経路である。新規の話を足さない。

```text
/validate-episode work/drafts/episode012.txt を検査して
/validate-episode 第12話を違反ゼロまで修正して
```

検査だけか、直すところまでかは依頼文で明示する。機械検査の読み方は [§10](#10-検証コマンドと結果の読み方)。

### 7-5. 完了の定義

本文を書いただけでは完了ではない。判定基準の正本は `AGENTS.md`。

長編1話:

- [ ] 設計資料と正典を読み、今回の制約を逐語引用で確定した
- [ ] 本文を `work/drafts/episode<NNN>.txt` へ保存した
- [ ] `bash scripts/check.sh --strict` の表記違反がゼロになった。repeat／vocab／cliche の警告は数えない
- [ ] 視点・キャラ・情報格差・時系列を資料と照合した
- [ ] `ai-novel-detector` で診断し、必要な改稿を `humanize-ai-writing` で行った。終了は `guidelines/06-revision-checklist.md` の G-3。警告の件数を目標に再診断を巡回しない
- [ ] 話単位の状態差分と正典台帳を更新した
- [ ] 改稿後に `check.sh --strict` と `python3 scripts/state_check.py --strict` を再実行した。文体の警告は `guidelines/05-ai-guardrails.md` §3-4 で採否済み

話番号のない単独短編（イラスト起点を含む）では、保存先は依頼の出力パスとし、資料がなければ本文内部の視点・呼称・時系列だけを照合する。状態差分と `state_check.py` は長編1話だけ必須とする。機械検査とAI文体診断は省略しない。

1つでも欠ける場合は、未完了としてどの段階が残っているかを報告する。

---

## 8. 小説の加工

書けた本文を、別の成果物へ変換する。**ここから新しい小説本文は書かない。** 書く仕事は [§7](#7-小説の書き方) に戻る。

| | 挿絵付きPDF | 漫画化 |
|---|---|---|
| 入力 | 本文＋`［挿絵：］`＋**既存の**画像フォルダ | 小説本文（マーカーは不要） |
| 中間成果 | なし | ページ脚本（1ページ2〜4コマ） |
| 出力 | A5縦のPDF | `work/generated/` のページPNG |
| 新しい絵を出すか | 出さない。既存画像を本文へ埋め込む | 出す。NovelAI V5（[§2](#2-novelai-公式api)） |
| 確認 | 欠落画像の報告 | 脚本の承認 → 生成の承認 |

イラストから書いた短編（§7-3）の次にやるのは、通常はPDFである。プロットから書いた長編（§7-1）を絵にするなら、漫画化である。

### 8-1. 挿絵付きPDFにする

`illust-r18-novel` の出力、または同等の `［挿絵：］` 付き `.txt` と、マーカーが指す画像フォルダを渡す。

```text
/illust-novel-pdf 本文と画像フォルダを指定する
```

既定（依頼なく変えない）:

| 項目 | 値 |
|---|---|
| 用紙 | A5縦 |
| 本文 | 11pt。地の文のみ全角1字下げ。台詞「」は字下げなし |
| 挿絵 | 本文枠の全幅。縦横比維持。番号・ファイル名・説明は出さない |

実装は `scripts/illust_text_to_pdf.py`。ローカルに reportlab 用の venv が要る（Skillが用意する）。欠落画像があれば完成としない。

漫画のコマ割りPDFや、縦書きは対象外である。

### 8-2. 漫画脚本から漫画を生成する

小説の文章を保存せず、情報・感情・因果を絵と台詞へ再配分する。1生成＝1ページ。縦スクロールWEBTOON連作の画像化はしない。

1. `/novel-to-manga-script` と本文（またはパス）。1ページは2〜4コマ。
2. ページ脚本を保存したら**確認を待つ。** この時点では画像化しない。
3. 承認後に `/nai-v5-prompt-designer` へ渡す。プロンプト Markdown を保存したら、また確認を待つ。
4. [§2](#2-novelai-公式api) のドライランのあと、承認されたページを1回ずつ生成する。生成結果の確認と3回出力は、利用者が明示したときだけ [§2-5](#2-5-選別と再生成)。

トークンの置き方、Anlas、失敗時の対処は §2。ブラウザ自動化はしない。

### 8-3. 小説からセリフ付き1枚絵にする

小説の文章を保存せず、1時点の絵とフキダシ1〜2へ再配分する。コマ割りしない。漫画ページが要るときは [§8-2](#8-2-漫画脚本から漫画を生成する)。

1. `/novel-to-dialogue-illust` と本文（またはパス）。
2. 作画ブリーフを保存したら**確認を待つ。** この時点では画像化しない。
3. 承認後に `/nai-v5-prompt-designer` へ渡す。プロンプト Markdown を保存したら、また確認を待つ。
4. [§2](#2-novelai-公式api) のドライランのあと、承認されたページを1回ずつ生成する。生成結果の確認と3回出力は、利用者が明示したときだけ [§2-5](#2-5-選別と再生成)。

トークンの置き方、Anlas、失敗時の対処は §2。ブラウザ自動化はしない。参照イメージにある大きな日本語擬音は、V5プロンプトへは出さない。

### 8-4. 挿絵1枚だけ生成する

漫画脚本もセリフ付き1枚絵のブリーフも経由せず、1枚絵（または指定した1ページ）だけ出すとき。

```text
/nai-v5-prompt-designer
```

あとの確認ゲートとAPIは [§8-2](#8-2-漫画脚本から漫画を生成する) の4と同じである。

---

## 9. スキルの一覧

経路から逆引きする索引である。起動は自然文でも `/skill-name` でもよい。

| 経路 | 使うSkill |
|---|---|
| プロットから長編 | `long-novel-orchestrator` → `write-episode` → `narrative-style-web-novel` または `novel-write-r18` → `validate-episode` |
| 企画・世界観の相談 | `novel-plot-advisor` / `novel-worldbuilding-advisor`（明示時だけ） |
| イラストから短編 | `illust-r18-novel` → `novel-write-r18` → `validate-episode` |
| 検査・改稿 | `validate-episode`（中で `ai-novel-detector` / `humanize-ai-writing`） |
| 挿絵PDF | `illust-novel-pdf` |
| 漫画化 | `novel-to-manga-script` → `nai-v5-prompt-designer` |
| セリフ付き1枚絵 | `novel-to-dialogue-illust` → `nai-v5-prompt-designer` |
| 挿絵1枚 | `nai-v5-prompt-designer` |

| スキル | 役割 |
|---|---|
| `long-novel-orchestrator` | 新規長編の最上位入口。1話ずつ完了させる |
| `write-episode` | 1話を設計確認から台帳更新まで完遂する（通常は orchestrator から） |
| `validate-episode` | 既存本文の検査・改稿。新規保存した本文の修正モード |
| `narrative-style-web-novel` | 非R18本文の文体（地の文主体／会話主体／混合） |
| `novel-write-r18` | 成人向け場面の文体。A系は `style-corpus/`、B系は `style-corpus-b/`。地の文の言い換えも含む |
| `illust-r18-novel` | 画像フォルダから挿絵付き官能短編 |
| `illust-novel-pdf` | 挿絵マーカー付き本文をPDF化 |
| `novel-to-manga-script` | 小説を1ページ2〜4コマの漫画脚本へ |
| `novel-to-dialogue-illust` | 小説をセリフ付き1枚絵（コマ割りなし）の作画ブリーフへ |
| `nai-v5-prompt-designer` | V5プロンプトと公式API画像化（1ページ） |
| `check-combat-equipment-terms` | 戦闘・装備用語の誤用予防 |
| `ai-novel-detector` | 意味の欠落・行為者の取り違え・声の均一化の診断。改稿はしない |
| `humanize-ai-writing` | 事実と声を保った改稿。小さな直接修正に診断の先行は不要 |
| `novel-plot-advisor` | 企画・プロットの相談（明示時だけ） |
| `novel-worldbuilding-advisor` | 世界観の相談（明示時だけ） |

---

## 10. 検証コマンドと結果の読み方

```bash
bash scripts/check.sh --strict work/drafts/episode012.txt
python3 scripts/normalize_blanklines.py --check work/drafts/episode012.txt
bash scripts/chars.sh work/drafts/episode012.txt
python3 scripts/repeat_check.py work/drafts/episode012.txt
python3 scripts/vocab_check.py work/drafts/episode012.txt
python3 scripts/cliche_check.py work/drafts/episode012.txt
python3 scripts/combat_terms_check.py work/drafts/episode012.txt
python3 scripts/state_check.py --strict
```

`check.sh` は本文そのものを、`state_check.py` は台帳の側を検査する。長編で先に壊れるのは台帳のほうで、本文ファイルと状態差分ファイルの対応、作中日時の連続、現在状態との一致、日付の正本（`world-bible/core/08-timeline.md §3`）と状態差分の突合、伏線の設置と回収、情報格差の事実IDを照合する。

**意味的な照合はスクリプトの対象外である。** 本文の出来事と状態差分の対応、canon-log の確定事項との整合、人物ごとの位置・所持品・負傷の連続は、本文の散文を読んで判断する必要があるため、`validate-episode` と `guidelines/06-revision-checklist.md` の目視手順が受け持つ。`state_check.py` が `[NG]` ゼロでも、これらが照合済みになるわけではない。

どちらも出力は2段階に分かれる。**この区別を混同しない。**

- **`[NG]`** — 機械的に一意な規約違反（マークダウン痕跡、他言語混入、閉じカギ前の句点、記号の派閥揺れなど）。`--strict` で exit 1 になる。**必ず直す。**
- **`[警告]`** — 候補（頻出語、クリシェクラスタ、逐語一致など）。exit code に影響しない。採否は `guidelines/05-ai-guardrails.md` §3-4。過去形の連続そのものは欠点にしない。正当な表現を消すために日本語を歪めない。

補助コマンド:

```bash
bash scripts/check.sh --help                       # セクション名一覧
bash scripts/check.sh --section lang <ファイル>     # 他言語混入だけ検査
python3 scripts/audit-repo.py                      # リポジトリ構成の一括監査
python3 scripts/cliche_check.py <ファイル>          # 直訳クリシェのクラスタ検査＋リズム参考値
bash scripts/eval.sh                               # 同梱フィクスチャによる検出ルールの回帰
```

`repeat_check.py`（話またぎの逐語一致）、`vocab_check.py`（職能語・口癖の飽和）、`cliche_check.py` の警告は候補である。採否は `guidelines/05-ai-guardrails.md` §3-4、逐語は `guidelines/02-narrative-craft.md` §5-3、職能語は同 §2-7。機能する反復は残し、再警告を避けるときだけ allowlist／watchlist へ理由を書く。警告の件数は完成条件にしない。リズム参考値は合否条件ではない。閾値を決めて数値を目標にすると、場面の速度と無関係な文長調整が始まり、かえって平坦になる。

`combat_terms_check.py` は戦闘・装備の部位、収納状態、操作、助数詞の高確度事故を検出する。装備が一切出ない話は結果が空でもよい。

`normalize_blanklines.py` は空行の過剰を検出する。自動整形は、Webからの貼り付けなどで空行が肥大した本文に対して、利用者の許可がある場合だけ適用する。

---

## 11. やってはいけないこと

- 検査が実行できない環境で「合格」と報告する。
- `[警告]` を消すために自然な日本語を不自然に書き換える。
- AIらしさを消す目的で誤字や不自然な崩しを作る。人間らしさは、具体性、偏り、含意、人物固有の判断から作る。
- 台帳に「物語が進んだ」のような抽象要約を書く。記録するのは、追加された事実、変化した関係、負傷・所持品・位置、未回収の約束、新たに知った人物である。
- 確定済み台帳の途中行だけを、関連する本文・正典・時系列を照合せずに書き換える。
- 利用者の既存の記述を、確認なしに上書きする。
- 場面の途中で視点を移す。他人の内面を断定する。
- 固定の台詞比率、比喩の数、文数を品質基準にする。
- NovelAI のトークンをチャット・本文・プロンプトMarkdownへ書く。
- プロンプトを保存したターンで、確認なしに実生成する。
- 縦スクロールWEBTOON連作を画像化する。

---

## 12. トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| `grep -P` でエラーになる | GNU grep でない。WSL／Linux を使うか GNU grep を導入する。検査不能を合格にしない |
| `check.sh` が全項目OKで終わる（違反があるのに） | ロケールが UTF-8 でない可能性。`python3 scripts/audit-repo.py` で自己診断する |
| スキルが起動しない | プロジェクトが信頼済みか、`.agents/skills/<名前>/SKILL.md` があるかを確認し、新しいセッションを開始する |
| `work/` が無い | `bash scripts/init-work.sh` を実行する |
| 話数と資料の対応が分からない | `work/continuity/current-state.md` の「最終確定話」を見る |
| 文字数が目安と合わない | `bash scripts/chars.sh` の実数と `work/plot.md` の目安を比較する。字数のために内容を薄めない |
| 設定が矛盾している疑いがある | アーク境界の監査を前倒しし、`canon-log` と `08-timeline` を突き合わせる。矛盾の解消を次話の執筆より優先する |
| Grokがファイルを書けない | `--sandbox read-only` になっていないか。作業ディレクトリで起動しているか |
| NovelAI が 401 | §2-7。トークンを再発行する。チャットには貼らない |

---

## 13. 用語

| 用語 | 意味 |
|---|---|
| Grok Build | ターミナルで動くAIアシスタント。本パッケージの実行環境。コマンドは `grok` |
| Skill | `.agents/skills/<名前>/SKILL.md` に書いた再利用手順。自然文または `/名前` で起動する |
| 正典（canon） | `world-bible/` に固定した、作品世界の確定事実 |
| 台帳 | 状態や確定事項を記録するファイル群（canon-log、continuity、pov-plan） |
| 情報格差 | 誰がどの事実をいつ知ったかの差。視点人物が知らない事実は地の文へ出さない |
| 視点アンカー | 場面冒頭で視点人物を確定させる、その人物固有の知覚描写 |
| 引き | 話末に置く、次を読む理由（問い、危険、関係変化、報酬の予感） |
| 場面転換記号 | 場面の区切りに使う記号。作品ごとに `work/plot.md` で1種類に固定する |
| 確認ゲート | プロンプトMarkdown保存後、実生成の前に利用者の承認を待つ手順。連続執筆より優先 |
| Anlas | NovelAI の有料生成通貨。通常解像度・28ステップ以下・1枚は Opus なら0 |
| ピン | V5のキャラクター配置。Characterカード（出現単位）ごとに打ち、対象コマの中央へ置く |
