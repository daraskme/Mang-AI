#!/usr/bin/env python3
"""語彙飽和の検査。

視点人物の職能語・口癖など、作品固有の「飽和しやすい語」の話単位の出現数を
work/vocab-watchlist.tsv の上限と突き合わせ、超過を[警告]として報告する。
知恵者系視点で計測・観測・査定の比喩が全場面へ流入する事故
（guidelines/02-narrative-craft.md §2-7、ai-novel-detector 観点10・23）を定量で拾う。

監視リストの書式（タブ区切り、# 始まりは注釈）:
  ラベル<TAB>パターン（Python正規表現）<TAB>1話の上限<TAB>メモ[<TAB>除外ファイル（カンマ区切り）]

上限は現行本文の実測から決める（ラチェット方式）。監視の目安であり、割当量ではない。
超過は guidelines/02-narrative-craft.md §2-7 の候補。意図的な密度は除外欄へ理由を書いて
再警告を避ける。意味を変える変奏で警告を消さない。

使い方:
  python3 scripts/vocab_check.py work/drafts/episode012.txt
  python3 scripts/vocab_check.py --all
  python3 scripts/vocab_check.py --strict --all   # 警告が残れば exit 1

終了コード: 0=警告なし（または--strictなし） / 1=--strictで警告あり / 2=検査不能
監視リストがない場合は検査対象なしとして exit 0（導入は任意）。
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DRAFTS = ROOT / "work" / "drafts"
DEFAULT_WATCHLIST = ROOT / "work" / "vocab-watchlist.tsv"


def load_watchlist(path: Path) -> list[dict]:
    rules = []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.rstrip("\n")
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        cols = line.split("\t")
        if len(cols) < 4:
            print(f"エラー: {path}:{lineno} 列が足りない（ラベル/パターン/上限/メモが必須）",
                  file=sys.stderr)
            sys.exit(2)
        label, pattern, limit, memo = cols[0], cols[1], cols[2], cols[3]
        exclude = {name.strip() for name in cols[4].split(",")} if len(cols) >= 5 and cols[4].strip() else set()
        try:
            compiled = re.compile(pattern)
        except re.error as exc:
            print(f"エラー: {path}:{lineno} 正規表現が不正: {exc}", file=sys.stderr)
            sys.exit(2)
        try:
            limit_n = int(limit)
        except ValueError:
            print(f"エラー: {path}:{lineno} 上限が整数でない: {limit!r}", file=sys.stderr)
            sys.exit(2)
        rules.append({"label": label, "re": compiled, "limit": limit_n,
                      "memo": memo, "exclude": exclude})
    return rules


def main() -> int:
    parser = argparse.ArgumentParser(description="語彙飽和（話単位の出現数上限）を検査する")
    parser.add_argument("targets", nargs="*", help="検査対象の本文ファイル")
    parser.add_argument("--all", action="store_true", help="drafts配下の全話を検査")
    parser.add_argument("--drafts-dir", type=Path, default=DEFAULT_DRAFTS,
                        help="--all の対象ディレクトリ")
    parser.add_argument("--watchlist", type=Path, default=DEFAULT_WATCHLIST,
                        help="監視リストのパス")
    parser.add_argument("--strict", action="store_true",
                        help="警告が1件でもあれば exit 1")
    parser.add_argument("--quiet", "-q", action="store_true", help="警告のみ出力")
    args = parser.parse_args()

    if not args.targets and not args.all:
        parser.print_usage(sys.stderr)
        print("エラー: 対象ファイルを指定するか --all を使う", file=sys.stderr)
        return 2

    if not args.watchlist.is_file():
        if not args.quiet:
            print(f"語彙飽和: 監視リストがないため検査対象なし（{args.watchlist}）")
        return 0

    rules = load_watchlist(args.watchlist)
    targets = [Path(t) for t in args.targets] if args.targets else \
        sorted(args.drafts_dir.glob("*.txt"))
    missing = [p for p in targets if not p.is_file()]
    if missing:
        for p in missing:
            print(f"エラー: ファイルがない: {p}", file=sys.stderr)
        return 2

    warnings = 0
    excluded = 0
    for p in targets:
        text = p.read_text(encoding="utf-8")
        for rule in rules:
            count = len(rule["re"].findall(text))
            if count <= rule["limit"]:
                continue
            if p.name in rule["exclude"]:
                excluded += 1
                continue
            warnings += 1
            print(f"[警告] 語彙飽和: {rule['label']} {count}回（上限{rule['limit']}） {p.name}")
            print(f"       {rule['memo']}")

    if not args.quiet or warnings:
        print(f"語彙飽和: 警告 {warnings}件（除外欄で採否済み {excluded}件、規則 {len(rules)}件、対象 {len(targets)}話）")
        if warnings:
            print(f"       対応: 02-narrative-craft §2-7 で採否する。"
                  f"残す密度は {args.watchlist} の除外欄へ理由を書いて再警告を避ける。"
                  "意味を変える変奏で警告を消さない")

    if args.strict and warnings:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
