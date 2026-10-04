#!/usr/bin/env bash
# 本文の文字数カウント（空白文字＝全角字下げ・半角空白・改行・タブを除外して数える）
# 使い方:
#   bash scripts/chars.sh work/drafts/episode03.txt
#   bash scripts/chars.sh work/drafts/*.txt
# 設計意図: for ループ等の動的シェル構文をこのファイル内に閉じ込め、
#   呼び出し側コマンドを静的解析可能（許可リスト対象）に保つための小ヘルパー。
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "使い方: bash scripts/chars.sh <file> [file ...]" >&2
  exit 2
fi

errors=0
for f in "$@"; do
  if [ ! -f "$f" ]; then
    echo "${f}: ファイルが見つかりません" >&2
    errors=$((errors + 1))
    continue
  fi
  n=$(python3 -c "import sys;print(sum(1 for c in open(sys.argv[1],encoding='utf-8').read() if not c.isspace()))" "$f")
  printf '%s\t%s字\n' "$f" "$n"
done

if [ "$errors" -gt 0 ]; then
  exit 2
fi
