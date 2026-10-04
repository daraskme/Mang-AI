# レイアウトとCLI（確定仕様）

本ファイルは `illust-novel-pdf` の組版正本の補足である。数値の凍結は `SKILL.md` の「確定仕様」と `scripts/illust_text_to_pdf.py` 先頭の定数を優先する。

## 1. 確定既定値

| 定数 | 値 |
|---|---|
| 用紙 | A5縦 |
| `DEFAULT_FONT_SIZE` | 11.0 pt |
| `DEFAULT_LINE_GAP` | 1.55 |
| `DEFAULT_MARGIN_SIDE_MM` | 8.0 |
| `DEFAULT_MARGIN_VERT_MM` | 12.0 |
| `DEFAULT_CHARS` | `None`（余白内最大全角数を自動） |

## 2. 組版規則

- エンジン: `scripts/illust_text_to_pdf.py`（reportlab + Pillow）
- 本文枠 = ページ幅 − 左右余白。本文・挿絵ともこの幅いっぱい
- 行折返し: 全角=1、半角=0.5。East Asian Wide/Fullwidth/Ambiguous は1
- **字下げ**（`guidelines/01-writing-rules.md` §7）:
  - 地の文: 段落冒頭に全角1字（`　`）
  - 台詞（行頭が `「` または `『`）: 字下げしない
- 段落間の空行: 本文中の空行を小さな空きとして再現
- 挿絵: キャプションなし。マーカー行はPDFに出さない

## 3. 画像の拡大規則

1. 目標幅 = 本文枠幅
2. 高さを縦横比で決定
3. 高さが「上下余白を除いた1ページ分」を超えるときだけ、幅・高さを同じ比率で縮小し中央寄せ

## 4. CLI

Unix:

```bash
.venv-pdf/bin/python scripts/illust_text_to_pdf.py TEXT.txt --images DIR [-o OUT.pdf]
```

Windows (pwsh):

```powershell
.venv-pdf\Scripts\python.exe scripts/illust_text_to_pdf.py TEXT.txt --images DIR [-o OUT.pdf]
```

| 引数 | 意味 | 確定時の扱い |
|---|---|---|
| `TEXT.txt` | マーカー付き本文 | 必須 |
| `--images DIR` | 画像フォルダ | 必須 |
| `-o OUT.pdf` | 出力 | 任意 |
| `--font-size PT` | 本文pt | 既定11。変更はユーザー明示時のみ |
| `--margin-side-mm N` | 左右余白mm | 既定8。変更はユーザー明示時のみ |
| `--margin-vert-mm N` | 上下余白mm | 既定12。変更はユーザー明示時のみ |
| `--chars N` | 全角換算行幅 | 省略＝自動。変更はユーザー明示時のみ |
| `--font PATH` | TTF/TTC | 環境に応じて指定可 |
| `--margin-mm N` | 上下左右同一mm | 後方互換。通常は使わない |

## 5. 依存

Pythonインタプリタは `AGENTS.md` シェル実行の規約の順（`python` → `py -3` → `python3`。WindowsApps除外）。

Unix:

```bash
<python> -m venv .venv-pdf
.venv-pdf/bin/python -m pip install reportlab pillow
```

Windows (pwsh):

```powershell
<python> -m venv .venv-pdf
.venv-pdf\Scripts\python.exe -m pip install reportlab pillow
```

`.venv-pdf/` は `.gitignore` 済み。reportlab は **TrueType / TTC** のみ。WSL では `/mnt/c/Windows/Fonts/YuGothR.ttc` が使えることが多い。

## 6. マーカー解決順

1. 絶対パス
2. 本文ファイルからの相対
3. `--images` / トークン
4. `--images` / basename
5. 拡張子補完（`.jpg` `.jpeg` `.png` `.webp` `.gif`）
6. 数字のみならゼロ埋め2桁・3桁

## 7. 失敗時

- 画像欠落: `missing images:`、終了コード1
- フォント不可: 終了コード2。`--font` を案内
