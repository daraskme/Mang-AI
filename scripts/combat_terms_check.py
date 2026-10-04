#!/usr/bin/env python3
"""日本語小説本文から戦闘・装備用語の高確度誤用と要文脈候補を検出する。"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Pattern


ROOT = Path(__file__).resolve().parent.parent
DRAFTS = ROOT / "work" / "drafts"


@dataclass(frozen=True)
class Rule:
    rule_id: str
    severity: str
    pattern: Pattern[str]
    message: str


@dataclass(frozen=True)
class Issue:
    path: Path
    line: int
    rule_id: str
    severity: str
    message: str
    excerpt: str


NUMERAL = "一二三四五六七八九十百千万〇零0-9"

LINE_RULES = (
    Rule(
        "CE001",
        "NG",
        re.compile(
            r"(?:柄袋[^。！？\n]{0,12}(?:を|に)?(?:握(?:る|り|った|って|り込)|掴(?:む|み|んだ))"
            r"|(?:握(?:る|り|った|って|り込)|掴(?:む|み|んだ))[^。！？\n]{0,12}柄袋)"
        ),
        "柄袋は収納時に柄へ被せる保護袋であり、使用時の握りではない",
    ),
    Rule(
        "CE002",
        "警告",
        re.compile(r"柄袋[^。！？\n]{0,18}(?:手に馴染|握り癖|掌の脂|手脂|艶)"),
        "技能や使い込みの痕跡なら、柄・柄巻き・袋の着脱習慣のどれを見たか確認する",
    ),
    Rule(
        "CE003",
        "NG",
        re.compile(
            r"(?:弓袋[^。！？\n]{0,35}(?:出さず|収めたまま|入れたまま|袋の中)[^。！？\n]{0,35}"
            r"(?:弦|空弦|矢をつが|射(?:る|た))"
            r"|弓袋[^。！？\n]{0,24}(?:空の弦|弦を弾))"
        ),
        "弓袋へ収めた弓は、特別な構造設定なしに弦操作や射撃を行えない",
    ),
    Rule(
        "CE004",
        "NG",
        re.compile(rf"(?:矢(?:を|が|の)?[{NUMERAL}]+丁|[{NUMERAL}]+丁(?:の)?矢)"),
        "矢の助数詞に丁を使っている。通常は本で数える",
    ),
    Rule(
        "CE005",
        "NG",
        re.compile(r"弦を(?:一気に|力任せに|全身で|素早く)?起こ(?:す|した|し|せ)"),
        "弓・弩の弦は機構に応じて張る、引く、留め具へ掛けるなどと書く",
    ),
    Rule(
        "CE006",
        "NG",
        re.compile(
            r"(?:柄巻き(?:から|へ)[^。！？\n]{0,8}(?:剣|刀)(?:を)?(?:抜|納)"
            r"|(?:剣|刀)(?:を)?柄巻き(?:から|へ)(?:抜|納))"
        ),
        "柄巻きは握りの外装であり、刀身を出し入れする収納具ではない",
    ),
    Rule(
        "CW001",
        "警告",
        re.compile(rf"(?:[{NUMERAL}]+丁弓|弓の[{NUMERAL}]+丁)"),
        "弓の数量なら一張・二張など誤読の少ない表現を検討する",
    ),
    Rule(
        "CW002",
        "警告",
        re.compile(r"一枚弓"),
        "構造を示すなら一本の木から削り出した弓、丸木弓、単材弓などを検討する",
    ),
    Rule(
        "CW003",
        "警告",
        re.compile(r"(?:峰[^。！？\n]{0,8}反り|反り[^。！？\n]{0,8}峰)"),
        "峰の反りという部位関係が意図どおりか、刀身全体の反りとの混同を確認する",
    ),
    Rule(
        "CW004",
        "警告",
        re.compile(r"(?:剣|刀)[^。！？\n]{0,12}弓[^。！？\n]{0,12}槍の穂先"),
        "完成武器と部品が同列に並ぶ。槍全体か交換用の穂かを確認する",
    ),
    Rule(
        "CW005",
        "警告",
        re.compile(r"弓袋(?:から|より)[^。！？\n]{0,12}矢(?:を)?(?:抜|取り出)"),
        "矢の収納具が弓袋でよいか、矢筒との混同を確認する",
    ),
    Rule(
        "CW006",
        "警告",
        re.compile(r"空弦"),
        "空弦は矢をつがえず弦を放つ行為。単なる弦のつま弾きと混同していないか確認する",
    ),
)


def compact_excerpt(line: str, limit: int = 96) -> str:
    excerpt = line.strip().replace("\t", " ")
    if len(excerpt) <= limit:
        return excerpt
    return excerpt[: limit - 1] + "…"


def scan_text(text: str, path: Path | None = None) -> list[Issue]:
    target = path or Path("<text>")
    lines = text.splitlines()
    issues: list[Issue] = []
    seen: set[tuple[str, int]] = set()

    for number, line in enumerate(lines, start=1):
        for rule in LINE_RULES:
            if rule.pattern.search(line) and (rule.rule_id, number) not in seen:
                seen.add((rule.rule_id, number))
                issues.append(
                    Issue(
                        path=target,
                        line=number,
                        rule_id=rule.rule_id,
                        severity=rule.severity,
                        message=rule.message,
                        excerpt=compact_excerpt(line),
                    )
                )

    # 同一段落内の名称揺れは、別部品を区別している可能性があるため警告に留める。
    offset = 0
    for paragraph in re.split(r"\n\s*\n", text):
        start_line = text[:offset].count("\n") + 1
        if "籠手" in paragraph and "手甲" in paragraph:
            key = ("CW007", start_line)
            if key not in seen:
                line = next(
                    (item for item in paragraph.splitlines() if "籠手" in item or "手甲" in item),
                    paragraph,
                )
                issues.append(
                    Issue(
                        path=target,
                        line=start_line,
                        rule_id="CW007",
                        severity="警告",
                        message="同一段落の籠手と手甲が同じ物か別部品か確認する",
                        excerpt=compact_excerpt(line),
                    )
                )
        offset += len(paragraph)
        while offset < len(text) and text[offset] == "\n":
            offset += 1

    # 一般的な剣形式と峰が同居する場合、片刃設定が確定しているかだけを問う。
    if re.search(r"片手剣|両手剣|長剣|短剣", text):
        for number, line in enumerate(lines, start=1):
            if "峰" in line and ("CW008", number) not in seen:
                issues.append(
                    Issue(
                        path=target,
                        line=number,
                        rule_id="CW008",
                        severity="警告",
                        message="一般剣の刃形式が未確定なら、片刃前提の峰を使わない",
                        excerpt=compact_excerpt(line),
                    )
                )
                break

    return sorted(issues, key=lambda item: (str(item.path), item.line, item.rule_id))


def scan_file(path: Path) -> list[Issue]:
    return scan_text(path.read_text(encoding="utf-8"), path)


def selftest() -> bool:
    cases = (
        ("柄袋を握って斬りつけた。", {"CE001"}),
        ("弓袋に収めたまま、空の弦を弾いた。", {"CE003"}),
        ("矢を二丁だけ残した。", {"CE004"}),
        ("全身で弦を起こした。", {"CE005"}),
        ("柄巻きから剣を抜いた。", {"CE006"}),
        ("二丁弓を壁へ立てた。", {"CW001"}),
        ("黒い一枚弓だった。", {"CW002"}),
        ("峰の反りを調べた。", {"CW003"}),
        ("剣と弓、槍の穂先を並べた。", {"CW004"}),
        ("弓袋から矢を抜いた。", {"CW005"}),
        ("籠手を外した。手甲だけを机へ置いた。", {"CW007"}),
    )
    for text, expected in cases:
        got = {issue.rule_id for issue in scan_text(text)}
        if not expected.issubset(got):
            print(f"[NG] selftest: {text!r} expected={expected} got={got}")
            return False

    clean = (
        "柄袋を外し、鍔元の紐を解いた。柄巻きはよく締まり、擦れも少ない。\n"
        "弓袋から弓を出し、弦を掛けた。矢筒から一本抜いてつがえる。\n"
        "弩の弦を引き、留め具へ掛けた。槍の石突きを地へ置く。\n"
    )
    got_clean = scan_text(clean)
    if got_clean:
        print(f"[NG] selftest clean case: {got_clean}")
        return False
    print("combat_terms_check.py selftest: PASS")
    return True


def iter_paths(files: Iterable[str], scan_all: bool) -> list[Path]:
    paths = [Path(item) for item in files]
    if scan_all:
        paths.extend(sorted(DRAFTS.glob("*.txt")))
    unique: list[Path] = []
    seen: set[Path] = set()
    for path in paths:
        resolved = path.resolve()
        if resolved not in seen:
            seen.add(resolved)
            unique.append(path)
    return unique


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="戦闘・装備用語の高確度誤用と要文脈候補を検出する"
    )
    parser.add_argument("files", nargs="*", help="検査する本文ファイル")
    parser.add_argument("--all", action="store_true", help="work/drafts/*.txt をすべて検査")
    parser.add_argument("--selftest", action="store_true", help="内蔵回帰テストを実行")
    parser.add_argument("--quiet", action="store_true", help="問題がないファイルの表示を省略")
    args = parser.parse_args(argv)

    if args.selftest:
        return 0 if selftest() else 1

    paths = iter_paths(args.files, args.all)
    if not paths:
        parser.error("対象ファイルを指定するか --all を使ってください")

    all_issues: list[Issue] = []
    for path in paths:
        if not path.is_file():
            print(f"[検査不能] ファイルがない: {path}", file=sys.stderr)
            return 2
        try:
            issues = scan_file(path)
        except (OSError, UnicodeError) as exc:
            print(f"[検査不能] {path}: {exc}", file=sys.stderr)
            return 2
        all_issues.extend(issues)
        if not issues and not args.quiet:
            print(f"[OK] {path}: 戦闘・装備用語の機械検出なし")

    for issue in all_issues:
        print(
            f"{issue.path}:{issue.line}: [{issue.severity}][{issue.rule_id}] "
            f"{issue.message} / {issue.excerpt}"
        )

    ng_count = sum(issue.severity == "NG" for issue in all_issues)
    warning_count = sum(issue.severity == "警告" for issue in all_issues)
    print(f"戦闘・装備用語: NG {ng_count}件 / 警告 {warning_count}件")
    return 1 if ng_count else 0


if __name__ == "__main__":
    raise SystemExit(main())
