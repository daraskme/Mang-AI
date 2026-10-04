---
name: illust-novel-pdf
description: >-
  挿絵マーカー付きの日本語小説本文に実画像を差し込み、PDF化する。
  確定仕様はA5縦・字11pt・左右余白8mm・上下12mm・余白内全幅・地の文のみ全角1字下げ・台詞は字下げなし・挿絵に番号説明なし。
  画像のない通常PDF、漫画シナリオ.docx化、本文の新規執筆には使わない。
when-to-use: >-
  「挿絵PDF」「画像付きPDF」「本文をPDF化」「illust pdf」「［挿絵：］を埋め込んで」
  「/illust-novel-pdf」
argument-hint: "本文.txt --images 画像フォルダ"
metadata:
  short-description: "［挿絵］マーカー本文に実画像を埋め込みPDF化"
---

# 挿絵付き小説 → PDF

## 役割

`［挿絵：…］` マーカーを含むプレーンテキスト本文と、画像フォルダを受け取り、**実画像を本文の流れに埋め込んだPDF**を生成する。

- 所有する：マーカー解釈、画像パス解決、組版（行幅・挿絵サイズ・字下げ）、PDF出力、欠落画像の報告
- 所有しない：本文の執筆・改稿（`illust-r18-novel` / `novel-write-r18`）、漫画シナリオ化

実装の正本は `scripts/illust_text_to_pdf.py`。CLI詳細は [references/layout-and-cli.md](references/layout-and-cli.md)。

## 確定仕様（凍結）

ユーザー承認済み。**依頼なく変更しない。** 上書きが必要なときだけ CLI 引数を使う。

| 項目 | 確定値 |
|---|---|
| 用紙 | A5縦 |
| 本文サイズ | **11pt** |
| 行送り | 11pt × 1.55 |
| 左右余白 | **8mm** |
| 上下余白 | **12mm** |
| 本文枠 | ページ幅 − 左右余白（余白内の横幅いっぱい） |
| 行の折返し | 字サイズ固定のまま、枠内に収まる全角換算文字数を自動（半角0.5） |
| 字下げ | **地の文**のみ段落冒頭全角1字。行頭 `「` `『` の台詞は**字下げ厳禁** |
| 挿絵 | 本文枠幅いっぱい。縦横比維持。1ページに収まらないときだけ全体を縮小し中央寄せ |
| 挿絵キャプション | **出さない**（番号・ファイル名・説明文なし。マーカー行もPDFに出さない） |
| フォント | TrueType/TTC 日本語（Yu Gothic / メイリオ等）。CFFのOTFは不可 |

字下げは `guidelines/01-writing-rules.md` §7 に準拠する。

## 入力

| 項目 | 必須 | 内容 |
|---|---|---|
| 本文 | 必須 | `.txt`（小説本文＋`［挿絵：…］` のみ） |
| 画像フォルダ | 必須 | マーカーが指す画像があるディレクトリ |
| 出力先 | 任意 | 未指定時は本文と同名の `.pdf` |
| フォント | 任意 | `--font` で TTF/TTC を指定 |

マーカー例（いずれも可）:

```
［挿絵：01］
［挿絵：01.jpg］
［挿絵：user-provided/szhr0321/01.jpg］
```

番号のみのとき、画像フォルダ直下の `01.jpg` / `01.png` 等を探索する。

## ワークフロー

### Step 1. 入力を確定する

1. 本文パスと画像フォルダをユーザー依頼または直前成果物から取る。
2. 本文を `read_file` で開き、`［挿絵：` の件数と、画像フォルダ内のファイルを照合する。
3. 依存とvenvは [references/layout-and-cli.md](references/layout-and-cli.md) に従う。`run_terminal_command` で実行する。Pythonは `AGENTS.md` シェル実行の規約のインタプリタ順。

### Step 2. PDFを生成する（確定仕様の既定のまま）

venvのPythonは Unix なら `.venv-pdf/bin/python`、Windows なら `.venv-pdf\Scripts\python.exe`。

```bash
<venv-python> scripts/illust_text_to_pdf.py \
  work/drafts/<本文>.txt \
  --images <画像フォルダ> \
  -o work/drafts/<出力>.pdf
```

引数なしの既定が確定仕様である。余白や字数を変える CLI は、ユーザーが明示したときだけ使う。

### Step 3. 結果を確認する

1. 終了コード0、`missing images` が空であること。
2. 可能なら先頭ページをレンダし、狭余白・挿絵全幅・地の文字下げ・台詞の非字下げを目視する。

```bash
pdftoppm -png -r 120 -f 1 -l 2 work/drafts/<出力>.pdf work/drafts/_pdf-check-<stem>
```

3. ユーザーへ **PDFパス・ページ数・埋め込み枚数・欠落** を報告する。

## 他Skillとの連携

| 相手 | 関係 |
|---|---|
| `illust-r18-novel` | 本文＋マーカーの主な供給元。PDF化は本Skill |
| `novel-write-r18` | 描写のみ。PDF化は関与しない |
| erotic-scenario-converter | 散文→漫画指示書（docx）。PDF小説とは別経路 |

`illust-r18-novel` 完了後に「PDFにして」と依頼されたら、本Skillを起動する。

## 所有しない作業

- 挿絵の新規生成・加工
- 本文へのキャプション追記
- 縦書き組版（将来拡張。現状は横書き）
- 確定仕様の無断変更
- 配布zipへの成人向け原稿の同梱判断（利用者の責任）
