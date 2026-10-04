#!/usr/bin/env python3
"""状態台帳の整合を機械的に照合する。

長編で破綻するのは本文そのものより台帳の側である。本文ファイルと話ごとの
状態差分、現在状態、日付の正本（world-bible/core/08-timeline.md §3）、
情報格差マトリクス、伏線台帳のあいだに生じるずれを、人手の読み合わせでは
なく機械検査で拾う。

検査するのは台帳どうしの機械的な対応であり、本文の内容には踏み込まない。
本文の出来事と状態差分の意味的な対応、canon-log の確定事項との整合、人物
ごとの位置・所持品・負傷の連続は、本文の散文を読んで判断する必要があるため
validate-episode と guidelines/06-revision-checklist.md の目視手順が受け持つ。
本スクリプトの合格をもって、それらを照合済みとみなさない。

判定は check.sh と同じ2段階にする。

  [NG]   機械的に一意な不整合。--strict で exit 1 の対象。必ず直す。
  [警告] 文脈判断が要る指標（回想話による日時の逆行など）。exit code に
         影響しない。作品意図として正当なら残してよい。

作中日時は作品ごとに架空の暦を使うため、汎用のカレンダー解析は行わない。
値の形が全話で揃っているときだけ数値列として比較し、揃っていなければ
「比較不能」として扱う。

使い方:
    python3 scripts/state_check.py
    python3 scripts/state_check.py --strict
    python3 scripts/state_check.py --root /path/to/work-repo --stale-episodes 30
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path


ROOT_DEFAULT = Path(__file__).resolve().parent.parent

DRAFT_RE = re.compile(r"^episode(\d+)\.txt$")
DELTA_RE = re.compile(r"^ep(\d+)\.md$")
SCENE_CARD_RE = re.compile(r"^ep(\d+)\.md$")
FIELD_RE = re.compile(r"^[-*]\s*(.+?)[:：]\s*(.*)$")
EPISODE_IN_TEXT_RE = re.compile(r"(?:ep|episode|第)\s*(\d+)")
FACT_ID_RE = re.compile(r"\bK\d{3,}\b")
FORESHADOW_ID_RE = re.compile(r"\bF\d{3,}\b")
NUMBERS_RE = re.compile(r"\d+")

# 伏線が未回収のまま何話続いたら確認を促すか。長編の目安であり、
# 作品の設計上もっと長い伏線は正当なので [警告] にとどめる。
DEFAULT_STALE_EPISODES = 20

# テンプレートの記入例をそのまま検出しないための目印。
PLACEHOLDER_MARKERS = ("（例", "(例", "（主人公）", "（必要時）")


@dataclass
class Report:
    """検査結果を種別ごとに集める。"""

    violations: list[tuple[str, str]] = field(default_factory=list)
    warnings: list[tuple[str, str]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def violation(self, section: str, message: str) -> None:
        self.violations.append((section, message))

    def warn(self, section: str, message: str) -> None:
        self.warnings.append((section, message))

    def note(self, message: str) -> None:
        self.notes.append(message)


def read_text(path: Path) -> str:
    """読めなければ空文字を返す。呼び出し側で存在確認を済ませておく。"""
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def is_placeholder(line: str) -> bool:
    return any(marker in line for marker in PLACEHOLDER_MARKERS)


def parse_table_rows(text: str, min_columns: int) -> list[list[str]]:
    """Markdownの表から、記入例と区切り行を除いたデータ行を取り出す。"""
    rows: list[list[str]] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|") or is_placeholder(stripped):
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if len(cells) < min_columns:
            continue
        if all(set(cell) <= {"-", ":", " "} for cell in cells):
            continue
        if not any(cells):
            continue
        rows.append(cells)
    return rows


def parse_fields(text: str) -> dict[str, str]:
    """`- 話：12` 形式の箇条書きを辞書にする。"""
    fields: dict[str, str] = {}
    for line in text.splitlines():
        match = FIELD_RE.match(line.strip())
        if match:
            key, value = match.group(1).strip(), match.group(2).strip()
            if key not in fields:
                fields[key] = value
    return fields


def episode_number(text: str) -> int | None:
    """「第12話」「ep012」「12」から話数を取り出す。"""
    text = text.strip()
    if not text:
        return None
    match = EPISODE_IN_TEXT_RE.search(text)
    if match:
        return int(match.group(1))
    if text.isdigit():
        return int(text)
    return None


def collect_numbers(text: str) -> tuple[int, ...]:
    return tuple(int(value) for value in NUMBERS_RE.findall(text))


def check_draft_delta_pairs(root: Path, report: Report) -> tuple[dict[int, Path], dict[int, Path]]:
    """本文と状態差分が1対1で対応しているかを見る。"""
    drafts_dir = root / "work/drafts"
    deltas_dir = root / "work/continuity/episodes"

    drafts: dict[int, Path] = {}
    if drafts_dir.is_dir():
        for path in sorted(drafts_dir.iterdir()):
            match = DRAFT_RE.match(path.name)
            if match:
                drafts[int(match.group(1))] = path

    deltas: dict[int, Path] = {}
    if deltas_dir.is_dir():
        for path in sorted(deltas_dir.iterdir()):
            match = DELTA_RE.match(path.name)
            if match:
                deltas[int(match.group(1))] = path

    for number in sorted(set(drafts) - set(deltas)):
        report.violation(
            "1. 本文と状態差分の対応",
            f"本文 {drafts[number].name} に対応する "
            f"work/continuity/episodes/ep{number:03d}.md がない",
        )
    for number in sorted(set(deltas) - set(drafts)):
        report.violation(
            "1. 本文と状態差分の対応",
            f"状態差分 {deltas[number].name} に対応する "
            f"work/drafts/episode{number:03d}.txt がない",
        )

    for number, path in sorted(deltas.items()):
        declared = parse_fields(read_text(path)).get("話", "")
        declared_number = episode_number(declared)
        if declared and declared_number is not None and declared_number != number:
            report.violation(
                "1. 本文と状態差分の対応",
                f"{path.name} の「話」欄が {declared!r} でファイル名と一致しない",
            )

    if not drafts and not deltas:
        report.note("本文と状態差分がまだない（新規作品）ため、対応検査は省略した")

    return drafts, deltas


def check_timeline_continuity(root: Path, deltas: dict[int, Path], report: Report) -> None:
    """作中日時の欠落・逆行・現在状態とのずれを見る。"""
    if not deltas:
        return

    dates: dict[int, str] = {}
    for number, path in sorted(deltas.items()):
        value = parse_fields(read_text(path)).get("作中日時", "")
        if not value:
            report.warn("2. 作中日時", f"ep{number:03d}.md の作中日時が空欄")
            continue
        dates[number] = value

    ordered = sorted(dates.items())
    shapes = {len(collect_numbers(value)) for _, value in ordered}
    comparable = len(shapes) == 1 and shapes != {0}

    if not comparable and len(ordered) >= 2:
        report.note("作中日時の表記が話ごとに異なるため、順序の自動比較は省略した")

    for (previous_number, previous_value), (number, value) in zip(ordered, ordered[1:]):
        if comparable and collect_numbers(value) < collect_numbers(previous_value):
            report.warn(
                "2. 作中日時",
                f"ep{number:03d} の作中日時 {value!r} が "
                f"ep{previous_number:03d} の {previous_value!r} より前。"
                "回想話なら正当、そうでなければ時系列の破綻",
            )
        elif value == previous_value:
            report.warn(
                "2. 作中日時",
                f"ep{previous_number:03d} と ep{number:03d} の作中日時が同一（{value!r}）。"
                "同一時刻の別視点なら正当",
            )

    current_state = root / "work/continuity/current-state.md"
    if not current_state.is_file():
        report.violation("3. 現在状態", "work/continuity/current-state.md がない")
        return

    fields = parse_fields(read_text(current_state))
    latest = max(deltas)
    declared = fields.get("最終確定話", "")
    declared_number = episode_number(declared)

    if not declared:
        report.violation("3. 現在状態", "current-state.md の「最終確定話」が空欄")
    elif declared_number is None:
        report.warn("3. 現在状態", f"current-state.md の最終確定話 {declared!r} から話数を読めない")
    elif declared_number != latest:
        report.violation(
            "3. 現在状態",
            f"current-state.md の最終確定話が {declared!r} だが、"
            f"状態差分の最新は ep{latest:03d}",
        )

    state_date = fields.get("作中日時", "")
    latest_date = dates.get(latest, "")
    if state_date and latest_date and state_date != latest_date:
        report.warn(
            "3. 現在状態",
            f"current-state.md の作中日時 {state_date!r} が "
            f"ep{latest:03d} の {latest_date!r} と一致しない",
        )


def timeline_section3(text: str) -> str:
    """08-timeline の §3（話別作中日付）だけを切り出す。

    §1 の暦法表や §2 の史実年表を巻き込むと、年号の数字を話数と読み違える。
    """
    lines = text.splitlines()
    start = None
    for index, line in enumerate(lines):
        if re.match(r"^##\s*3[.．]", line.strip()):
            start = index + 1
            break
    if start is None:
        return ""
    end = len(lines)
    for index in range(start, len(lines)):
        if lines[index].strip().startswith("## "):
            end = index
            break
    return "\n".join(lines[start:end])


def dates_agree(delta_value: str, timeline_value: str) -> bool:
    """作中日時が同じ日を指しているかを、暦の形式に依存せず判定する。

    08-timeline は「開始〜終了」の範囲、状態差分は当該話の日時を持つため、
    文字列の完全一致は期待できない。数値列の包含か、文字列の包含で見る。
    """
    delta_value = delta_value.strip()
    timeline_value = timeline_value.strip()
    if not delta_value or not timeline_value:
        return True
    if delta_value in timeline_value or timeline_value in delta_value:
        return True
    delta_numbers = collect_numbers(delta_value)
    timeline_numbers = collect_numbers(timeline_value)
    if delta_numbers and timeline_numbers:
        return all(number in timeline_numbers for number in delta_numbers)
    return False


def check_timeline_source(root: Path, deltas: dict[int, Path], report: Report) -> None:
    """日付の正本（08-timeline §3）と状態差分の作中日時を突き合わせる。

    日付の正本は world-bible/core/08-timeline.md §3 であり、状態差分はそこから
    転記した値を持つ。両者のずれは本文を読まずに検出できる唯一の正典照合なので、
    ここだけは機械検査に載せる。canon-log の確定事項や人物ごとの位置・所持品は
    本文の散文と意味で照合する必要があるため、Skill側の目視手順に残す。
    """
    if not deltas:
        return

    timeline = root / "world-bible/core/08-timeline.md"
    if not timeline.is_file():
        report.note(
            "world-bible/core/08-timeline.md がないため、日付の正本との照合は省略した"
        )
        return

    section = timeline_section3(read_text(timeline))
    if not section:
        report.warn(
            "6. 時系列の正本",
            "08-timeline.md に「## 3.」の話別作中日付がない。日付の正本が未整備",
        )
        return

    rows: dict[int, str] = {}
    for cells in parse_table_rows(section, min_columns=2):
        number = episode_number(cells[0])
        if number is None:
            continue
        if number in rows:
            report.warn(
                "6. 時系列の正本",
                f"08-timeline §3 に第{number}話の行が複数ある",
            )
            continue
        rows[number] = cells[1]

    if not rows:
        report.warn(
            "6. 時系列の正本",
            "08-timeline §3 に話別作中日付の行がない。"
            "本文確定後の1行追記が滞っている",
        )
        return

    for number, path in sorted(deltas.items()):
        if number not in rows:
            report.violation(
                "6. 時系列の正本",
                f"{path.name} に対応する第{number}話の行が 08-timeline §3 にない",
            )
            continue
        delta_date = parse_fields(read_text(path)).get("作中日時", "")
        if not dates_agree(delta_date, rows[number]):
            report.warn(
                "6. 時系列の正本",
                f"ep{number:03d}.md の作中日時 {delta_date!r} が "
                f"08-timeline §3 の {rows[number]!r} と一致しない。日付の正本は 08-timeline",
            )

    for number in sorted(set(rows) - set(deltas)):
        report.warn(
            "6. 時系列の正本",
            f"08-timeline §3 に第{number}話の行があるが "
            f"work/continuity/episodes/ep{number:03d}.md がない。先行記入なら正当",
        )


def check_foreshadowing(root: Path, deltas: dict[int, Path], report: Report, stale_after: int) -> None:
    """伏線台帳の設置・回収の対応と、放置された伏線を見る。"""
    plot = root / "work/plot.md"
    if not plot.is_file():
        report.note("work/plot.md がないため、伏線台帳の検査は省略した")
        return

    text = read_text(plot)
    latest = max(deltas) if deltas else 0
    checked = 0

    for cells in parse_table_rows(text, min_columns=6):
        identifier = cells[0]
        if not FORESHADOW_ID_RE.fullmatch(identifier):
            continue
        checked += 1
        placed_raw, resolved_raw, status = cells[2], cells[3], cells[5]
        placed = episode_number(placed_raw)
        resolved_numbers = [
            int(value) for value in EPISODE_IN_TEXT_RE.findall(resolved_raw)
        ]

        if placed is None:
            report.violation("4. 伏線台帳", f"{identifier} の設置章 {placed_raw!r} から話数を読めない")
            continue

        for resolved in resolved_numbers:
            if resolved < placed:
                report.violation(
                    "4. 伏線台帳",
                    f"{identifier} の回収章 第{resolved}話 が設置章 第{placed}話 より前",
                )

        if status == "未回収":
            if resolved_numbers and max(resolved_numbers) <= latest:
                report.warn(
                    "4. 伏線台帳",
                    f"{identifier} は回収章（{resolved_raw}）を通過済みだが状態が「未回収」のまま",
                )
            elif not resolved_numbers and latest - placed >= stale_after:
                report.warn(
                    "4. 伏線台帳",
                    f"{identifier} は第{placed}話で設置してから {latest - placed} 話、"
                    "回収章も未定のまま放置されている",
                )

    if checked == 0:
        report.note("伏線台帳に記入済みの行がないため、伏線検査は省略した")


def check_fact_references(root: Path, report: Report) -> None:
    """情報格差マトリクスに存在しない事実IDが参照されていないかを見る。"""
    pov_plan = root / "work/pov-plan.md"
    if not pov_plan.is_file():
        report.note("work/pov-plan.md がないため、事実IDの検査は省略した")
        return

    known = set(FACT_ID_RE.findall(read_text(pov_plan)))
    if not known:
        report.note("情報格差マトリクスに事実IDがないため、事実IDの検査は省略した")
        return

    sources: list[Path] = []
    for folder in (root / "work/scene-cards", root / "work/continuity/episodes"):
        if folder.is_dir():
            sources.extend(sorted(folder.glob("*.md")))

    for path in sources:
        missing = sorted(set(FACT_ID_RE.findall(read_text(path))) - known)
        if missing:
            report.violation(
                "5. 事実IDの参照",
                f"{path.relative_to(root)} が参照する {', '.join(missing)} が "
                "work/pov-plan.md の情報格差マトリクスにない",
            )


def check_scene_card_coverage(root: Path, drafts: dict[int, Path], report: Report) -> None:
    """本文があるのにシーンカードが残っていない話を拾う。"""
    scene_cards_dir = root / "work/scene-cards"
    if not scene_cards_dir.is_dir() or not drafts:
        return

    existing = {
        int(match.group(1))
        for path in scene_cards_dir.iterdir()
        if (match := SCENE_CARD_RE.match(path.name))
    }
    for number in sorted(set(drafts) - existing):
        report.warn(
            "7. シーンカード",
            f"ep{number:03d} の本文はあるが work/scene-cards/ep{number:03d}.md がない",
        )


def render(report: Report, quiet: bool) -> None:
    for section, message in report.violations:
        print(f"[NG]   {section}: {message}")
    for section, message in report.warnings:
        print(f"[警告] {section}: {message}")
    if not quiet:
        for message in report.notes:
            print(f"[情報] {message}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "状態台帳（本文ファイルと状態差分の対応・作中日時・現在状態・"
            "日付の正本・情報格差・伏線）の整合を照合する"
        ),
    )
    parser.add_argument("--root", default=str(ROOT_DEFAULT), help="リポジトリのルート")
    parser.add_argument("--strict", action="store_true", help="[NG]が1件でもあれば exit 1")
    parser.add_argument("--quiet", action="store_true", help="[情報]を抑止する")
    parser.add_argument(
        "--stale-episodes",
        type=int,
        default=DEFAULT_STALE_EPISODES,
        help=f"未回収の伏線を放置とみなす話数（既定 {DEFAULT_STALE_EPISODES}）",
    )
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not (root / "work").is_dir():
        print(f"検査不能: {root}/work がない。bash scripts/init-work.sh を実行する", file=sys.stderr)
        return 2

    report = Report()
    drafts, deltas = check_draft_delta_pairs(root, report)
    check_timeline_continuity(root, deltas, report)
    check_timeline_source(root, deltas, report)
    check_foreshadowing(root, deltas, report, args.stale_episodes)
    check_fact_references(root, report)
    check_scene_card_coverage(root, drafts, report)

    render(report, args.quiet)
    print(f"\n結果: NG {len(report.violations)} / 警告 {len(report.warnings)}")

    if args.strict and report.violations:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
