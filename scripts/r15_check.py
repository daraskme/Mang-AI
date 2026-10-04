#!/usr/bin/env python3
"""R15版成果物に露骨語彙・♡が残っていないか検査する。"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
EXPLICIT = re.compile(
    r"♡|膣|陰茎|亀頭|陰核|肉棒|肉穴|精液|射精|中出し|種付け|"
    r"ぬち(?:ゅ|ゃ|ょ)?|ぐちゅ|ぐぽ|ずぷ|ずちゅ|ぱんぱん"
)


def collect(targets: list[str], root: Path) -> list[Path]:
    if not targets:
        targets = ["work/r15/build", "dist/合本_絶頂鑑定_R15版_全57話.txt"]
    paths: list[Path] = []
    for raw in targets:
        path = Path(raw)
        if not path.is_absolute():
            path = root / path
        if path.is_dir():
            paths.extend(sorted(path.glob("*.txt")))
        elif path.is_file():
            paths.append(path)
        else:
            raise FileNotFoundError(path)
    return list(dict.fromkeys(path.resolve() for path in paths))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("targets", nargs="*")
    parser.add_argument("--root", default=str(ROOT))
    parser.add_argument("--quiet", "-q", action="store_true")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    try:
        paths = collect(args.targets, root)
    except FileNotFoundError as exc:
        print(f"検査不能: 入力がない: {exc}", file=sys.stderr)
        return 2
    if not paths:
        print("検査不能: 対象テキストがない", file=sys.stderr)
        return 2

    hits = 0
    for path in paths:
        text = path.read_text(encoding="utf-8")
        for line_number, line in enumerate(text.splitlines(), 1):
            matches = list(EXPLICIT.finditer(line))
            if not matches:
                continue
            hits += len(matches)
            if not args.quiet:
                terms = ", ".join(match.group(0) for match in matches)
                print(f"[NG] {path.relative_to(root)}:{line_number}: {terms}")

    print(f"R15露骨表現検査: 対象 {len(paths)}ファイル / 検出 {hits}件")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
