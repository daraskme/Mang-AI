#!/usr/bin/env python3
"""正本とR15派生版から二サイト用の話別投稿ファイルと日程表を生成する。"""

from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

from build_r15 import ROOT, parse_titles, read_text


KAKUYOMU_DIR = "絶頂鑑定_kakuyomu"
NOCTURNE_DIR = "絶頂鑑定_nocturne"
STATIC_FILES = (
    "README.md",
    f"{KAKUYOMU_DIR}/作品設定.txt",
    f"{KAKUYOMU_DIR}/近況ノート_開始告知.txt",
    f"{NOCTURNE_DIR}/作品設定.txt",
    f"{NOCTURNE_DIR}/最終話あとがき.txt",
)


def schedule_date(start: date | None, day: int) -> str:
    return (start + timedelta(days=day)).isoformat() if start else "未定"


def schedule_text(titles: dict[str, str], start: date | None) -> str:
    start_label = start.isoformat() if start else "未定（開始日決定後に --start-date で再生成）"
    lines = [
        f"# 投稿スケジュール（開始日: {start_label}。D0=開始日、D27の21:10に完結）",
        "# 列: 日次 / 日付 / 時刻 / サイト(kakuyomu=R15版・nocturne=完全版) / 話数 / サブタイトル / ファイル / ★ / 備考",
        "# ★列は「完全版で濃厚場面のある話」のフラグ。カクヨムのサブタイトルには★を付けない（2026-08-06裁定）",
        "日次\t日付\t時刻\tサイト\t話数\tサブタイトル\tファイル\t★\t備考",
    ]
    episodes = sorted(titles)
    first = [episode for episode in episodes if int(episode) <= 3]
    later = [episode for episode in episodes if int(episode) > 3]
    order = [
        *((episode, site) for site in ("kakuyomu", "nocturne") for episode in first),
        *((episode, site) for episode in later for site in ("kakuyomu", "nocturne")),
    ]
    for episode, site in order:
        number = int(episode)
        if number <= 3:
            day, time = 0, "18:10"
        else:
            day = ((number - 4) // 2) + 1
            time = "06:10" if number % 2 == 0 else "21:10"
        title = titles[episode]
        star = "★" if "★" in title else "—"
        notes = {
            (1, "kakuyomu"): "初回。作品を新規作成してから3話を続けて公開",
            (1, "nocturne"): "初回。作品を新規作成してから3話を続けて公開",
            (57, "kakuyomu"): "最終話。公開後に完結処理（README参照）",
            (57, "nocturne"): "最終話。公開後に完結処理（README参照）",
        }
        site_title = title.replace("★", "") if site == "kakuyomu" else title
        site_dir = KAKUYOMU_DIR if site == "kakuyomu" else NOCTURNE_DIR
        subtitle = f"第{number}話　{site_title}"
        lines.append(
            "\t".join(
                (
                    f"D{day}",
                    schedule_date(start, day),
                    time,
                    site,
                    str(number),
                    subtitle,
                    f"{site_dir}/ep{episode}.txt",
                    star,
                    notes.get((number, site), "—"),
                )
            )
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(ROOT))
    parser.add_argument("--output-dir", default="dist/投稿キット_絶頂鑑定")
    parser.add_argument("--start-date", help="開始日（YYYY-MM-DD）。省略時は日付を『未定』にする")
    parser.add_argument("--check", action="store_true", help="既存成果物と比較し、書き換えない")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    output_dir = root / args.output_dir
    try:
        start = date.fromisoformat(args.start_date) if args.start_date else None
        titles = parse_titles(root / "work/r15/titles.tsv")
        outputs: dict[Path, str] = {output_dir / "スケジュール.tsv": schedule_text(titles, start)}
        for episode, title in titles.items():
            full = read_text(root / f"work/drafts/episode{episode}.txt").strip("\n")
            r15 = read_text(root / f"work/r15/build/episode{episode}.txt").strip("\n")
            number = int(episode)
            outputs[output_dir / f"{NOCTURNE_DIR}/ep{episode}.txt"] = (
                f"第{number}話　{title}\n\n{full}\n"
            )
            outputs[output_dir / f"{KAKUYOMU_DIR}/ep{episode}.txt"] = (
                f"第{number}話　{title.replace('★', '')}\n\n{r15}\n"
            )
    except (OSError, ValueError) as exc:
        print(f"生成不能: {exc}", file=sys.stderr)
        return 2

    if args.check:
        mismatches = [
            path for path, expected in outputs.items()
            if not path.is_file() or read_text(path) != expected
        ]
        for path in mismatches:
            print(f"不一致: {path.relative_to(root)}")
        if mismatches:
            print(f"投稿キット: 不一致 {len(mismatches)}件")
            return 1
        print(f"投稿キット: 二サイト各{len(titles)}話＋日程表が正本と一致")
        return 0

    missing_static = [name for name in STATIC_FILES if not (output_dir / name).is_file()]
    if missing_static:
        print(
            "生成不能: 投稿用の固定文面が不足: " + ", ".join(missing_static),
            file=sys.stderr,
        )
        return 2
    for path, content in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8", newline="\n")
    print(f"投稿キット: 二サイト各{len(titles)}話＋日程表を生成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
