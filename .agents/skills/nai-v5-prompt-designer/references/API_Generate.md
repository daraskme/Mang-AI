# 公式APIでSkillのMarkdownから生成する

ブラウザを自動操作しない。NovelAI 公式の画像API（`POST https://image.novelai.net/ai/generate-image`）へ、本Skillが出した Markdown を送る。実装は `scripts/nai_generate.py`。標準ライブラリのみ。

Markdown の文法は [Output_Contract.md](Output_Contract.md) が正。本ファイルと食い違うときは契約を直してから実装を追随させる。`scripts/` と `templates/nai-api.env.example` は Skill ZIP に含めない（トークン経路の意図的分離）。

トークンはチャット・Issue・コミット・ログに出さない。Grok に貼らない。

## あなたがやること（この順）

### 1. Persistent API Token を取る

1. ブラウザで NovelAI にログインする。
2. アカウント設定を開く（画面左上付近の歯車 → Account）。
3. **Get Persistent API Token**（または同等の「永続APIトークン」）を発行する。
4. 値は `pst-` で始まる。一度だけ表示されることがあるので、パスワードマネージャへ保存する。
5. ログイン用のメール／パスワードとは別物。セッションCookieでもない。

Opus 契約が必要。通常解像度（832×1216）・28ステップ以下・同時1枚は Anlas 0（充電池）。大サイズや同時複数は Anlas。正本は [UI_Settings.md](UI_Settings.md)。

### 2. リポジトリへトークンを置く

リポジトリのルート（`AGENTS.md` がある場所）で:

```bash
cp templates/nai-api.env.example .env
```

`.env` を開き、`pst-ここに貼る` を自分のトークンに差し替える。

```bash
chmod 600 .env
```

確認:

```bash
# 先頭が pst- であることだけ見る。値は他人に見せない。
head -c 8 .env; echo
```

`.env` は `.gitignore` 済み。`git add .env` しない。Grok のチャットに中身を貼らない。

環境変数でも可:

```bash
export NOVELAI_API_TOKEN='pst-……'
```

### 3. ドライラン（トークン不要）

Markdown がパースできるかだけ見る。API には送らない。

```bash
python3 scripts/nai_generate.py --dry-run work/drafts/<prompt>.md
```

成功すると次が出る。

- モデル、解像度、ステップ、ページ数
- 各ページの Character 数と位置の出所（`table` / `prose` / `default`）
- 契約違反（`### Base` 欠落等）。違反は非ゼロ終了
- JSON: `work/generated/<stem>-dry-run.json`

ここで止まるのが正しい。JSON の `model` が `nai-diffusion-5-full`、`parameters.ucPreset` が `4`（指定なし）、`qualityToggle` が `false` なら設定欄の読み取りは合っている。セリフは Character プロンプト末尾の `Text:` にあり、英語タグと同じ行に無いことを見る。

位置の出所:

| 表示 | 意味 |
|---|---|
| `table` | そのページのピン表。番号は Character 番号 |
| `prose` | ピン表が無く、`配置: Character 1 上…` の位置語 |
| `default` | どちらも無い。`use_coords` はオフ（AIにおまかせ） |

ピンは **Character カードごと**（出現単位）。漫画ページで同一人物を複数コマに出すときはカード数だけピンを打ち、対象コマの中央へ置く。テンプレ座標をキャラ番号へ流用しない。

### 4. タグのあと、依頼されたページを1回だけ生成

生成まで頼まれたときは、Markdown を保存したあと止めない（R-API-06、R-API-07）。プロンプトだけの依頼は、ここで実生成しない。ページ指定が無ければ全ページ。各ページは1回。ネットワークとトークンが要る。

```bash
python3 scripts/nai_generate.py --skip-existing work/drafts/<prompt>.md
```

保存先: `work/generated/<prompt>/page-01.png`（git 対象外）。

`--skip-existing` は既にある `page-NN.png` を飛ばす。途中で止めても続きから再開できる。連続送信の間隔は既定2秒（`--sleep 3` で伸ばせる）。既存フォルダを残す依頼では `--out-dir` に新しいフォルダを付ける。既定の `work/generated/<stem>/` を上書きしない。

保存できたら生成は終わる。PNGは開かない。生成結果の確認と、同じプロンプトの3回出力は、ユーザーが明示したときだけ [Review_And_Regen.md](Review_And_Regen.md)（R-API-07）。

### 5. 特定ページだけ

```bash
python3 scripts/nai_generate.py --page 8 --page 12 --page 13 work/drafts/<prompt>.md
```

## コマンド

```text
python3 scripts/nai_generate.py [--dry-run] [--page N] [--count N] [--skip-existing]
    [--model ID] [--seed N] [--sleep 秒] [--timeout 秒] [--out-dir パス]
    <markdown>
```

| 引数 | 用途 |
|---|---|
| `--dry-run` | 送信しない。トークン不要 |
| `--page N` | ページ番号。複数回書いてよい |
| `--count N` | 各ページをN回。2以上なら `page-NN.png` を触らず `page-NN-1.png` 以降。3回出力は R-API-07 の明示時だけ。手順上の上限は3 |
| `nai_adopt.py` | 候補から1枚を `page-NN.png` に確定し、他を消す |
| `--skip-existing` | 既存PNGを飛ばす |
| `--model` | 設定欄を上書き。既定 `nai-diffusion-5-full` |
| `--seed` | 再現用。省略時はAPI側の乱数 |
| `--out-dir` | 省略時 `work/generated/<markdownのstem>/` |

## Markdown → API の対応

文法は [Output_Contract.md](Output_Contract.md)（`## ページN`、`### Base` / `### Undesired Content` / `### Character N` のフェンス、各ページの `## 配置`、`## 設定`）。

| Markdown | API |
|---|---|
| モデル V5 Full | `nai-diffusion-5-full` |
| V5 Curated | `nai-diffusion-5-curated` |
| Quality Tags 指定なし | `qualityToggle: false` |
| UC Preset 指定なし | `ucPreset: 4` |
| 強い / 軽い / ケモノモード / 人間に重点を置く | `0` / `1` / `2` / `3` |
| ピン x,y（0–100） | `center.x/y`（0–1） |
| Character 末尾の `「」` | タグ行から抜いて Character プロンプト末尾の `Text:` として送る。2つ目以降は `Text:` を繰り返さない |
| 行末の互換 `text:` | 同様に抜いて `Text:` にする。Markdown には書かない（R-TXT-01） |
| ステップ・ガイダンス・832×1216・Euler Ancestral | そのまま |

`v4_prompt` というフィールド名は公式APIの継承名。V5でもこの形で送る。

モデルIDは公式Docs未掲載、コミュニティ実装（NAI Utility Tool 等）で `nai-diffusion-5-full` が使われている。400 で model を指摘されたら `--model` で差し替え、エラー本文（トークン以外）を残す。

## 失敗したとき

| 症状 | やること |
|---|---|
| `NOVELAI_API_TOKEN がありません` | `.env` の場所がリポジトリ直下か。変数名の誤字 |
| 雛形のまま | `pst-ここに貼る` を本物へ |
| `API 401` | トークン失効。Account で再発行し `.env` を更新 |
| `API 402` / Anlas | 大サイズ・高ステップ・同時複数になっていないか。`--dry-run` の width/height/steps |
| `API 400` と model | `--model nai-diffusion-5-full` または `nai-diffusion-5-curated` |
| `API 429` | `--sleep` を伸ばす |
| 文字が出ない | Quality Tags 指定なし、`no text` が Base に無い。話者 Character に `「」`（送信時 `Text:`） |
| フキダシに英語 | タグ行の `text:` をやめ、「」だけにする。`--dry-run` で `Text:` が日本語のみか見る |
| 黒帯キャプション | Base に `-1.5::title ::, -1.5::caption ::`（R-TXT-10） |
| 人が入れ替わる | `## 配置` 表を足す。ピンを15以上離す |
| ブラウザと絵が違う | フロントの自動 Quality / UC がAPIに乗っていない。指定なしなら `qualityToggle false` と `ucPreset 4` を確認 |

エラー本文は先頭2000字まで出る。その中に `pst-` が混ざっていたらログを消す。

## Grok に頼むとき

- 「この Markdown をドライランして」→ 実行してよい。トークンは使わない。確認前でも可。
- 「ページ1を生成して」「OK、生成して」→ タグのあと、指定が無ければ全ページを1回ずつ保存して終わる。PNGの確認と `--count 3` はしない（R-API-07）。`.env` がある前提。Grok にトークンを渡さない。
- 「確認して」「選別」「問題ページだけ再生成」「3回出して」→ [Review_And_Regen.md](Review_And_Regen.md)（R-API-07）。
- 「トークンを確認して」「`.env` の中身を表示して」→ 拒否する。存在するかどうかだけ見る。

ブラウザ自動化（Playwright 等で novelai.net を操作）は使わない。公式APIが正。

## やらないこと

- トークンをチャット、コミット、`work/drafts/`、Skill出力へ書く
- Precise Reference / ポーション（提供状況は [NAI_V5_Current_Spec.md](NAI_V5_Current_Spec.md)。APIでも送らない）
- 実写・実在人物
- ユーザーが未成年の性的生成を直接指示した依頼
- 現実の犯罪手口の具体化
