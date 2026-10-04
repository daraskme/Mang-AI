#!/usr/bin/env python3
"""Japanese dialogue/quotation extractor with nearby nonblank context.

This script enumerates evidence for a human semantic audit. Candidate labels are
recall-oriented hints, not pass/fail judgments.
"""

from __future__ import annotations

import argparse
import glob
import re
import sys
from pathlib import Path


DIALOGUE_RE = re.compile(r"「.*?」", re.DOTALL)
COUNT_RE = re.compile(r"[一二三四五六七八九十百0-9０-９]+(?:回|度|段|歩|つ|人|本)")
POINTER_RE = re.compile(r"(?:これ|それ|あれ|ここ|そこ|あそこ|向こう|主)(?:は|が|を|に|だ|で|！|？|、|。|$)")
GENERIC_STEMS = (
    "送",
    "洗",
    "流",
    "通",
    "受け",
    "回",
    "落と",
    "拾",
    "乗せ",
    "灯",
    "返",
    "切",
    "入れ",
    "出し",
)
LABEL_RE = re.compile(r"皮肉|嫌味|冗談|脅し|嘘|当てこすり")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="台詞・作中引用を前後の非空行つきで全件抽出する（判定は行わない）"
    )
    parser.add_argument("paths", nargs="*", help="本文ファイル、ディレクトリ、またはglob")
    parser.add_argument(
        "--context",
        type=int,
        default=2,
        help="前後に表示する非空行数（既定: 2）",
    )
    parser.add_argument(
        "--only-candidates",
        action="store_true",
        help="注意候補だけ表示する（完了証跡には使用不可）",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="既知の見落とし例に対する回帰テストを実行する",
    )
    return parser.parse_args()


def expand_paths(patterns: list[str]) -> list[Path]:
    found: list[Path] = []
    for raw in patterns:
        path = Path(raw)
        if path.is_file():
            found.append(path)
        elif path.is_dir():
            found.extend(sorted(path.glob("*.txt")))
        else:
            found.extend(Path(item) for item in sorted(glob.glob(raw)) if Path(item).is_file())
    unique: list[Path] = []
    seen: set[str] = set()
    for path in found:
        key = str(path.resolve())
        if key not in seen:
            seen.add(key)
            unique.append(path)
    return unique


def nearby_nonblank(lines: list[str], anchor: int, count: int, direction: int) -> list[tuple[int, str]]:
    result: list[tuple[int, str]] = []
    index = anchor + direction
    while 0 <= index < len(lines) and len(result) < count:
        value = lines[index].strip()
        if value:
            result.append((index + 1, value))
        index += direction
    if direction < 0:
        result.reverse()
    return result


def candidate_reasons(dialogue: str, context: str) -> list[str]:
    reasons: list[str] = []
    hits = {stem for stem in GENERIC_STEMS if stem in dialogue}
    if len(hits) >= 2:
        reasons.append("汎用動詞連結")
    if COUNT_RE.search(dialogue):
        reasons.append("回数・順序の根拠")
    if POINTER_RE.search(dialogue):
        reasons.append("指示語・一般名詞の参照先")
    if LABEL_RE.search(context):
        reasons.append("叙述ラベルとの一致")
    return reasons


def extract(path: Path, context_size: int) -> list[dict[str, object]]:
    source = path.read_text(encoding="utf-8-sig")
    lines = source.splitlines()
    records: list[dict[str, object]] = []
    for serial, match in enumerate(DIALOGUE_RE.finditer(source), start=1):
        start_line = source.count("\n", 0, match.start())
        end_line = source.count("\n", 0, match.end())
        before = nearby_nonblank(lines, start_line, context_size, -1)
        after = nearby_nonblank(lines, end_line, context_size, 1)
        dialogue = match.group(0).replace("\n", "\\n")
        context = " ".join(text for _, text in before + after)
        line_start = source.rfind("\n", 0, match.start()) + 1
        prefix = source[line_start : match.start()]
        records.append(
            {
                "serial": serial,
                "line": start_line + 1,
                "kind": "台詞" if not prefix.strip() else "埋込発話・作中引用",
                "dialogue": dialogue,
                "before": before,
                "after": after,
                "reasons": candidate_reasons(dialogue, context),
            }
        )
    return records


def print_record(path: Path, record: dict[str, object]) -> None:
    print(f"## D{record['serial']:04d} [{record['kind']}] {path}:{record['line']}")
    for line_no, value in record["before"]:  # type: ignore[union-attr]
        print(f"前 L{line_no}: {value}")
    print(f"台詞: {record['dialogue']}")
    for line_no, value in record["after"]:  # type: ignore[union-attr]
        print(f"後 L{line_no}: {value}")
    reasons = record["reasons"]
    print("候補: " + ("／".join(reasons) if reasons else "なし"))  # type: ignore[arg-type]
    print()


def run_self_test() -> int:
    cases = (
        ("「送って洗った」", "", "汎用動詞連結"),
        ("「三回間違えた」", "", "回数・順序の根拠"),
        ("「主！　主だし！」", "", "指示語・一般名詞の参照先"),
        ("「普通の感想よ」", "彼女は皮肉を返した。", "叙述ラベルとの一致"),
    )
    for dialogue, context, expected in cases:
        reasons = candidate_reasons(dialogue, context)
        if expected not in reasons:
            print(f"[NG] {dialogue}: {expected} を検出できません", file=sys.stderr)
            return 1
    print(f"自己テスト: OK（{len(cases)}件）")
    return 0


def main() -> int:
    args = parse_args()
    if args.self_test:
        return run_self_test()
    if args.context < 0:
        print("--context は0以上で指定してください", file=sys.stderr)
        return 2
    if not args.paths:
        print("対象ファイルを指定してください", file=sys.stderr)
        return 2
    paths = expand_paths(args.paths)
    if not paths:
        print("対象ファイルが見つかりません", file=sys.stderr)
        return 2
    total = 0
    spoken_total = 0
    candidate_total = 0
    for path in paths:
        records = extract(path, args.context)
        total += len(records)
        spoken_total += sum(record["kind"] == "台詞" for record in records)
        candidate_total += sum(bool(record["reasons"]) for record in records)
        file_spoken = sum(record["kind"] == "台詞" for record in records)
        print(f"# {path}（発話・引用 {len(records)}件／行頭台詞 {file_spoken}件）")
        print()
        for record in records:
            if args.only_candidates and not record["reasons"]:
                continue
            print_record(path, record)
    print(
        f"合計: 発話・引用 {total}件 / 行頭台詞 {spoken_total}件 / "
        f"注意候補 {candidate_total}件 / 対象 {len(paths)}ファイル"
    )
    if args.only_candidates:
        print("注意: --only-candidates の出力だけでは全件監査の完了証跡になりません")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
