#!/usr/bin/env python3
"""話またぎの逐語反復検査。

work/drafts/ の各話本文を突き合わせ、指定長（既定12字）以上の逐語一致を[警告]として
報告する。単一ファイル検査の check.sh では見えない、話をまたいだ言い回しの
使い回し（guidelines/02-narrative-craft.md §5-3、ai-novel-detector 観点6）を拾う。

意図的な定型（システム表示、儀式文、決め口上）は work/continuity/phrase-allowlist.txt
へ1行1語句で登録すると抑止される。# 始まりの行は注釈。登録には理由の注釈を添える。

出力の[警告]は候補である。採否は guidelines/02-narrative-craft.md §5-3。
言い換えは義務ではない。機能する定型は allowlist へ理由を書いて再警告を避ける。
意味を変える変奏や、警告を消すためだけの登録はしない。
--strict は未処理の警告が残ると exit 1 にする検査用オプションであり、通常の完成条件ではない。

使い方:
  python3 scripts/repeat_check.py work/drafts/episode012.txt   # 対象話 vs 既存全話
  python3 scripts/repeat_check.py --all                        # 全話総当たり
  python3 scripts/repeat_check.py --strict --all               # 警告が残れば exit 1

終了コード: 0=警告なし（または--strictなし） / 1=--strictで警告あり / 2=検査不能
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DRAFTS = ROOT / "work" / "drafts"
DEFAULT_ALLOWLIST = ROOT / "work" / "continuity" / "phrase-allowlist.txt"
DEFAULT_MIN_LEN = 12

# 一致範囲として意味を持たない文字（場面区切り・空白・引用記号・感嘆の飾り）。
# これらだけで構成される一致や、これらを多く含む一致は言い回しの再利用ではない。
_NOISE_RE = re.compile(r"[\s※♡♥…―ー〜~！!？?。、，,．.「」『』（）()【】]")


def _content_len(s: str) -> int:
    """記号・空白を除いた実質文字数。"""
    return len(_NOISE_RE.sub("", s))


def _normalize(s: str) -> str:
    """allowlist照合用の正規化（空白除去＋NFKC）。"""
    return unicodedata.normalize("NFKC", re.sub(r"\s+", "", s))


def load_allowlist(path: Path) -> list[str]:
    if not path.is_file():
        return []
    entries = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        entries.append(_normalize(line))
    return entries


def is_allowed(span: str, allowlist: list[str]) -> bool:
    """spanがallowlistの登録語句に相当するか。

    登録語句がspanを包含する（登録が長め）か、spanの7割以上を登録語句が
    占める（span末尾に句読点などが付いただけ）場合に抑止する。
    """
    n = _normalize(span)
    if not n:
        return True
    for entry in allowlist:
        if n in entry:
            return True
        if entry in n and len(entry) >= 0.7 * len(n):
            return True
    return False


def _grams(text: str, k: int) -> dict[str, list[int]]:
    table: dict[str, list[int]] = defaultdict(list)
    for i in range(len(text) - k + 1):
        g = text[i : i + k]
        if "\n" in g:
            continue
        table[g].append(i)
    return table


def common_spans(a: str, b: str, k: int) -> list[tuple[int, int, int]]:
    """aとbの共通部分文字列（長さk以上）を対角線マージで求める。

    戻り値は (a開始, b開始, 長さ) のリスト。同一対角線上の連続一致を
    1つの極大一致にまとめる。
    """
    table = _grams(b, k)
    diagonals: dict[int, list[int]] = defaultdict(list)
    for i in range(len(a) - k + 1):
        g = a[i : i + k]
        if "\n" in g:
            continue
        for j in table.get(g, ()):
            diagonals[i - j].append(i)

    spans = []
    for d, positions in diagonals.items():
        positions.sort()
        start = prev = positions[0]
        for i in positions[1:]:
            if i <= prev + 1:
                prev = i
                continue
            spans.append((start, start - d, prev - start + k))
            start = prev = i
        spans.append((start, start - d, prev - start + k))
    return spans


def line_of(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def main() -> int:
    parser = argparse.ArgumentParser(description="話またぎの逐語反復を検査する")
    parser.add_argument("targets", nargs="*", help="検査対象の本文ファイル")
    parser.add_argument("--all", action="store_true", help="drafts配下の全話を総当たりで検査")
    parser.add_argument("--min-len", type=int, default=DEFAULT_MIN_LEN,
                        help=f"警告する一致の最小文字数（既定{DEFAULT_MIN_LEN}）")
    parser.add_argument("--drafts-dir", type=Path, default=DEFAULT_DRAFTS,
                        help="比較対象の本文ディレクトリ")
    parser.add_argument("--allowlist", type=Path, default=DEFAULT_ALLOWLIST,
                        help="許可リストのパス")
    parser.add_argument("--strict", action="store_true",
                        help="未処理の警告が1件でもあれば exit 1")
    parser.add_argument("--quiet", "-q", action="store_true", help="警告のみ出力")
    args = parser.parse_args()

    if not args.targets and not args.all:
        parser.print_usage(sys.stderr)
        print("エラー: 対象ファイルを指定するか --all を使う", file=sys.stderr)
        return 2

    corpus_paths = sorted(args.drafts_dir.glob("*.txt")) if args.drafts_dir.is_dir() else []
    target_paths = [Path(t) for t in args.targets] if args.targets else list(corpus_paths)

    missing = [p for p in target_paths if not p.is_file()]
    if missing:
        for p in missing:
            print(f"エラー: ファイルがない: {p}", file=sys.stderr)
        return 2
    if not corpus_paths and not args.all:
        print(f"エラー: 比較対象がない: {args.drafts_dir}", file=sys.stderr)
        return 2

    texts: dict[Path, str] = {}
    for p in {*(p.resolve() for p in target_paths), *(p.resolve() for p in corpus_paths)}:
        texts[p] = p.read_text(encoding="utf-8")

    target_set = {p.resolve() for p in target_paths}
    allowlist = load_allowlist(args.allowlist)

    # 検査ペア：対象×対象は片方向、対象×非対象は必ず。
    pairs = []
    all_paths = sorted(texts)
    for idx, a in enumerate(all_paths):
        for b in all_paths[idx + 1:]:
            if a in target_set or b in target_set:
                pairs.append((a, b))

    # 一致文字列 → 出現箇所（ファイル:行）の集合
    findings: dict[str, set[str]] = defaultdict(set)
    suppressed = 0
    seen_suppressed: set[str] = set()
    for a, b in pairs:
        ta, tb = texts[a], texts[b]
        for ai, bi, length in common_spans(ta, tb, args.min_len):
            span = ta[ai : ai + length]
            if _content_len(span) < max(6, args.min_len // 2):
                continue
            if is_allowed(span, allowlist):
                if span not in seen_suppressed:
                    seen_suppressed.add(span)
                    suppressed += 1
                continue
            findings[span].add(f"{a.name}:{line_of(ta, ai)}")
            findings[span].add(f"{b.name}:{line_of(tb, bi)}")

    # 別の一致に完全包含される短い一致は重複報告しない
    spans_sorted = sorted(findings, key=len, reverse=True)
    reported: list[str] = []
    for s in spans_sorted:
        if any(s in longer for longer in reported):
            for loc in findings[s]:
                findings[next(l for l in reported if s in l)].add(loc)
            continue
        reported.append(s)

    for s in reported:
        display = s.replace("\n", "／")
        if len(display) > 48:
            display = display[:48] + "……"
        locs = " / ".join(sorted(findings[s]))
        print(f"[警告] 逐語一致（{len(s)}字）: 「{display}」")
        print(f"       {locs}")

    if not args.quiet or reported:
        print(f"逐語反復: 警告 {len(reported)}件（allowlist抑止 {suppressed}件、最小{args.min_len}字）")
        if reported:
            print("       対応: 02-narrative-craft §5-3 で採否する。"
                  f"残す定型は {args.allowlist} へ理由を書いて再警告を避ける。"
                  "意味を変える変奏や、警告を消すためだけの登録はしない")

    if args.strict and reported:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
