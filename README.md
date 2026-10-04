# Mang-AI — ローカル漫画・画像・動画制作

日本語のQwenエージェント、Gemmaの創作・キャプション、Krea 2、MiniMax H3、LoRA学習、吹き出し編集、IOPaint、モザイクをまとめた制作環境です。実体は `/mnt/solidigm-b/Mang-AI/`。KDEタスクバーの **Mang-AI** から起動します。

**メディアギャラリー**はサイドバーの「ギャラリー」から開けます。データセット、セッションごとの制作中の漫画、生成画像・動画を閲覧し、キャプション確認・動画再生・編集再開ができます。エージェントには「ギャラリーを開いて」と依頼できます。

詳しい操作・モデル構成・検証方法は [制作ツールの説明](manga-studio/README.md)、ソースの復元は [統合環境の説明](integrations/README.md) を参照してください。以下は同梱する小説執筆環境の説明です。

## 長編小説執筆環境

三人称多元視点の日本語長編Web小説を、設定・時系列・人物像・伏線・情報格差を破綻させずに執筆するためのGrok用リポジトリです。1リポジトリを1作品として使います。

Grokは `AGENTS.md` を自動で読みます（配置・状態・完了手順・シェルの正本）。本文の表記・台詞・表現の採否・確認範囲は `guidelines/` が正本です。利用者向けの詳しい運用手順は `MANUAL.md` にあります。`MANUAL.md` は冒頭で Grok Build と NovelAI 公式APIを説明し、続けて「本文を書く経路」と「書けた本文を加工する経路」を分けて案内します。

## 必要な環境

ローカルモデルでセッションごとに漫画を作る **DSH 漫画制作ツール** は [manga-studio/README.md](manga-studio/README.md) を参照してください。Gemma が日本語脚本、Qwen がエージェント操作、Krea 2 公式 Python が作画を担当し、吹き出しと文字は専用ツールで入力します。起動は `manga-studio/` で `npm start`。以下は従来の小説執筆環境の案内です。

制作環境の実体は `/mnt/solidigm-b/Mang-AI/` にあります。Krea 2 画像生成、MiniMax H3 動画生成、画像認識による自然言語キャプション、Krea 2 LoRA 学習・登録を DSH の専用ツールから操作できます。各環境のモデル・仮想環境も同じフォルダ配下です。起動と依頼例は上記マニュアルにまとめています。

IOPaintによる画像補完とmosaic_editorによる画像・動画モザイクも統合しています。共通GUIで自動検出・手描き編集・履歴復元ができ、エージェント用の編集ツールからも操作できます。

`audit-repo.py` は小説環境と追加ソースを監査し、モデル・仮想環境・外部アプリ・移行アーカイブ・データセット・学習履歴のツリーは走査しません。漫画ツールは `manga-studio/` の `npm test` と `npm run test:dsh`、キャプション環境は `caption-studio/` の `runtime/node --test tests/*.test.mjs` で検証します。

| 必要なもの | 用途 |
|---|---|
| Grok（CLI / Build TUI） | 執筆・診断・Skill実行 |
| bash | `scripts/*.sh` |
| Python 3.11以降 | `scripts/*.py` |
| GNU grep | `scripts/check.sh` のPCRE検査 |

## セットアップ

このディレクトリで Grok を起動し（推奨: `grok --sandbox workspace`）、次を実行します。

```bash
chmod +x scripts/*.sh
bash scripts/init-work.sh
python3 scripts/audit-repo.py
```

`FAIL 0` で導入完了です。`init-work.sh` は既存ファイルを上書きしません。

NovelAI の公式APIを使う場合だけ、トークンを自分で置きます。配布物にトークンは含まれません。NovelAIの利用は、NovelAIの利用規約およびコンテンツポリシーに従ってください。本パッケージはそれらの許諾を含みません。

```bash
cp templates/nai-api.env.example .env
```

`.env` の `pst-ここに貼る` を自分の Persistent API Token に差し替え、`chmod 600 .env` します。チャットに貼らないでください。

## 使い方

作業は **書く** と **加工する** に分かれます。詳細と経路の違いは `MANUAL.md` の §4・§7・§8 です。

### 小説を書く

| 手元にあるもの | 依頼例 |
|---|---|
| 世界観やプロットから長編を始めたい | `世界観とプロットを設計したい` のあと `第1話を書いて` |
| 投稿先や読者への約束を詰めたい | `/novel-plot-advisor 序盤3話の読者への約束を詰めたい` |
| 通貨・旅程・文化を詰めたい | `/novel-worldbuilding-advisor 大陸間交易の通貨を設計したい` |
| 設計済みの続きを書く | `第12話を書いて` または `/long-novel-orchestrator 第12話` |
| 既存のイラストから挿絵付き短編を書く | `/illust-r18-novel` と画像フォルダ（新しい絵は出さない） |
| 既存本文を検査・改稿する | `/validate-episode 第12話を検査して` |
| 成人向け場面の文体 | 対象と条件を明示して `/novel-write-r18` |

長編では執筆前に `world-bible/`、`work/character-sheet-*.md`、`work/pov-plan.md`、`work/plot.md` を埋めます。第3話まで書けたら、確定本文から `work/style-samples.md` を作ります。

### 書けた小説を加工する

| やりたいこと | 依頼例 |
|---|---|
| 挿絵マーカー付き本文をPDFにする | `/illust-novel-pdf`（既存画像を埋め込む。新しい絵は出さない） |
| 小説を漫画脚本にし、ページ画像を生成する | `/novel-to-manga-script` のあと承認して `/nai-v5-prompt-designer`。1ページ2〜4コマ |
| 小説をセリフ付き1枚絵にする | `/novel-to-dialogue-illust` のあと承認して `/nai-v5-prompt-designer`。コマ割りなし、フキダシ1〜2 |
| 挿絵1枚だけ生成する | `/nai-v5-prompt-designer`。1生成＝1ページ |

イラストから短編を書いたあとの次工程は通常PDFです。プロットから書いた長編を絵にするなら漫画化です。縦スクロール連作の画像化はしません。

## 主な検査

```bash
bash scripts/check.sh --strict work/drafts/episode012.txt
python3 scripts/normalize_blanklines.py --check work/drafts/episode012.txt
bash scripts/chars.sh work/drafts/episode012.txt
python3 scripts/state_check.py --strict
bash scripts/eval.sh
```

`[NG]` は表記として直します。`[警告]` は候補で、採否は `guidelines/05-ai-guardrails.md` §3-4 です。警告の件数は完成条件にしません。本文と台帳の意味的な整合は、Skillの目視手順で確認します。`eval.sh` はテンプレート同梱の固定データに対する回帰テストです。

NovelAI のドライラン（トークン不要）:

```bash
python3 scripts/nai_generate.py --dry-run work/drafts/<prompt>.md
```

## ファイルの役割

| 場所 | 内容 |
|---|---|
| `AGENTS.md` | Grokが自動で読む。配置・状態・完了手順・シェルの正本。本文規約は `guidelines/` |
| `LICENSE` | 利用条件 |
| `MANUAL.md` | 詳細な運用マニュアル |
| `.agents/skills/` | 執筆・診断・相談ワークフロー |
| `.grok/config.toml` | プロジェクト設定 |
| `guidelines/` | 正書法・視点・構造・改稿の規約 |
| `templates/` | 作品設計と状態管理の雛形 |
| `tests/` | 検査スクリプトの回帰フィクスチャ |
| `work/` | プロット、人物、本文、状態台帳（`init-work.sh` が生成） |
| `world-bible/` | 世界観正典、時系列、確定事項（`init-work.sh` が生成） |
