#!/usr/bin/env python3
"""
Web小説サイト（なろう／カクヨム／ノクターン等）からコピペされた本文の
空行を正規化する。または空行の過剰連続を検出する（--check）。

正規化ルール（確定・Webペースト由来の本文専用）:
    N行連続空行 → max(0, N-2) 行に圧縮
    元 1行空行 → 0行（密着）
    元 3行空行 → 1行
    元 5行空行 → 3行
    元 7行空行 → 5行

【注意】正規化は1行空行を密着させるため、規約通りに書いた新規ドラフト
（1段落1空行）に掛けてはいけない。新規ドラフトの検査は --check を使う。
文体モードにかかわらず、4行以上の連続空行は過剰候補として確認する。

全角空白（U+3000）のみの行・空白のみ行は空行扱いに正規化する。
本文・記号・場面区切り（◇◇◇◇／＿＿＿＿＿等）には触らない。

使い方:
    scripts/normalize_blanklines.py <入力> [<出力>]
        正規化を実行。出力省略時は <入力ステム>_修正版.<拡張子> を作成。
    scripts/normalize_blanklines.py --check [閾値] <入力>
        書き換えず、閾値（既定4）以上の連続空行の位置を報告するだけ。
        検出ありで exit 1、なしで exit 0。
"""
import re
import sys
from pathlib import Path


def normalize(text: str) -> str:
    lines = [
        ("" if re.fullmatch(r"[　\s]*", l) else l.rstrip())
        for l in text.split("\n")
    ]
    result = []
    i = 0
    while i < len(lines):
        if lines[i] == "":
            j = i
            while j < len(lines) and lines[j] == "":
                j += 1
            run = j - i
            result.extend([""] * max(0, run - 2))
            i = j
        else:
            result.append(lines[i])
            i += 1
    joined = "\n".join(result).strip("\n")
    return joined + "\n" if joined else ""


def check_runs(text: str, threshold: int) -> list[tuple[int, int]]:
    """閾値以上の連続空行の (開始行番号, 連続数) を返す（1-indexed）。"""
    lines = [
        ("" if re.fullmatch(r"[　\s]*", l) else l.rstrip())
        for l in text.split("\n")
    ]
    runs = []
    i = 0
    while i < len(lines):
        if lines[i] == "":
            j = i
            while j < len(lines) and lines[j] == "":
                j += 1
            if j - i >= threshold:
                runs.append((i + 1, j - i))
            i = j
        else:
            i += 1
    return runs


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2

    if argv[1] == "--check":
        rest = argv[2:]
        threshold = 4
        if rest and rest[0].isdigit():
            threshold = int(rest[0])
            rest = rest[1:]
        if not rest:
            print(__doc__, file=sys.stderr)
            return 2
        src = Path(rest[0])
        if not src.exists():
            print(f"入力が存在しない: {src}", file=sys.stderr)
            return 2
        runs = check_runs(src.read_text(encoding="utf-8"), threshold)
        if not runs:
            print(f"OK: {threshold}行以上の連続空行なし（{src.name}）")
            return 0
        for start, count in runs:
            print(f"{src.name}:{start}: 空行{count}行連続")
        print(f"検出 {len(runs)}箇所（閾値{threshold}行。意味上必要な空行か本文と照合）")
        return 1

    src = Path(argv[1])
    if not src.exists():
        print(f"入力が存在しない: {src}", file=sys.stderr)
        return 1
    if len(argv) >= 3:
        dst = Path(argv[2])
    else:
        dst = src.with_name(f"{src.stem}_修正版{src.suffix}")
    text = src.read_text(encoding="utf-8")
    out = normalize(text)
    dst.write_text(out, encoding="utf-8")
    print(f"入力: {src.name}  {len(text.split(chr(10)))}行 / {len(text)}字")
    print(f"出力: {dst.name}  {len(out.split(chr(10)))}行 / {len(out)}字")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
