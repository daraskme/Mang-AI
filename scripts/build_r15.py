#!/usr/bin/env python3
"""完全版の正本と分割表からR15版話別本文・二版合本を生成する。"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
EPISODE_RE = re.compile(r"episode(\d{3})\.txt$")
SCENE_SEPARATOR = "※　※　※"
OMNIBUS_SEPARATOR = "═" * 20


@dataclass(frozen=True)
class Segment:
    episode: str
    number: int
    scene: int
    start_after: str
    end_before: str
    bridge: str


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8").replace("\r\n", "\n")


def parse_titles(path: Path) -> dict[str, str]:
    titles: dict[str, str] = {}
    for line_number, raw in enumerate(read_text(path).splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        cells = raw.split("\t", 1)
        if len(cells) != 2 or not re.fullmatch(r"\d{3}", cells[0]):
            raise ValueError(f"{path}:{line_number}: 話数と話名を読めない")
        if cells[0] in titles:
            raise ValueError(f"{path}:{line_number}: ep{cells[0]} が重複")
        titles[cells[0]] = cells[1].strip()
    return titles


def parse_manifest(path: Path) -> dict[str, list[Segment]]:
    data_lines = [
        line for line in read_text(path).splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    reader = csv.DictReader(data_lines, delimiter="\t")
    required = {"ep", "seg", "scene", "start_after", "end_before", "bridge"}
    if reader.fieldnames is None or not required.issubset(reader.fieldnames):
        raise ValueError(f"{path}: 必須列が不足")

    result: dict[str, list[Segment]] = {}
    seen: set[tuple[str, int]] = set()
    for row in reader:
        episode = row["ep"].strip()
        number = int(row["seg"])
        key = (episode, number)
        if not re.fullmatch(r"\d{3}", episode) or key in seen:
            raise ValueError(f"{path}: ep/seg が不正または重複: {episode}/{number}")
        seen.add(key)
        result.setdefault(episode, []).append(
            Segment(
                episode=episode,
                number=number,
                scene=int(row["scene"]),
                start_after=row["start_after"],
                end_before=row["end_before"],
                bridge=row["bridge"].strip(),
            )
        )
    for segments in result.values():
        segments.sort(key=lambda item: item.number)
    return result


def scene_bounds(lines: list[str], scene_number: int) -> tuple[int, int]:
    separators = [index for index, line in enumerate(lines) if line == SCENE_SEPARATOR]
    starts = [0, *(index + 1 for index in separators)]
    ends = [*separators, len(lines)]
    if scene_number < 1 or scene_number > len(starts):
        raise ValueError(f"場面{scene_number}は存在しない（全{len(starts)}場面）")
    start, end = starts[scene_number - 1], ends[scene_number - 1]
    while start < end and not lines[start].strip():
        start += 1
    while end > start and not lines[end - 1].strip():
        end -= 1
    return start, end


def unique_anchor(lines: list[str], anchor: str, start: int, end: int) -> int:
    matches = [index for index in range(start, end) if lines[index] == anchor]
    if len(matches) != 1:
        raise ValueError(f"アンカー一致が{len(matches)}件: {anchor!r}")
    return matches[0]


def replacement_lines(bridge: str, bridges_dir: Path) -> list[str]:
    if bridge == "-":
        return []
    path = bridges_dir / bridge
    if not path.is_file():
        raise ValueError(f"ブリッジがない: {path}")
    return read_text(path).strip("\n").splitlines()


def splice_segment(lines: list[str], start: int, end: int, replacement: list[str]) -> list[str]:
    before = lines[:start]
    after = lines[end:]
    while before and not before[-1].strip():
        before.pop()
    while after and not after[0].strip():
        after.pop(0)
    middle = ["", *replacement, ""] if replacement else []
    return [*before, *middle, *after]


def build_episode(text: str, segments: list[Segment], bridges_dir: Path) -> str:
    lines = text.rstrip("\n").splitlines()
    edits: list[tuple[int, int, list[str], Segment]] = []
    for segment in segments:
        scene_start, scene_end = scene_bounds(lines, segment.scene)
        start = (
            scene_start
            if segment.start_after == "場面頭"
            else unique_anchor(lines, segment.start_after, scene_start, scene_end) + 1
        )
        end = (
            scene_end
            if segment.end_before == "場面末"
            else unique_anchor(lines, segment.end_before, scene_start, scene_end)
        )
        if start > end:
            raise ValueError(f"ep{segment.episode}-{segment.number}: アンカー順が逆")
        edits.append((start, end, replacement_lines(segment.bridge, bridges_dir), segment))

    edits.sort(key=lambda item: item[0])
    for previous, current in zip(edits, edits[1:]):
        if previous[1] > current[0]:
            raise ValueError(
                f"ep{current[3].episode}: seg{previous[3].number}とseg{current[3].number}が重複"
            )
    for start, end, replacement, _ in reversed(edits):
        lines = splice_segment(lines, start, end, replacement)
    return "\n".join(lines).strip("\n") + "\n"


def omnibus(frontmatter: str, titles: dict[str, str], bodies: dict[str, str], *, r15: bool) -> str:
    chunks = [frontmatter.strip("\n")]
    for episode in sorted(bodies):
        title = titles[episode].replace("★", "") if r15 else titles[episode]
        heading = f"第{int(episode)}話　{title}"
        chunks.append(
            f"{OMNIBUS_SEPARATOR}\n{heading}\n{OMNIBUS_SEPARATOR}\n\n"
            f"{bodies[episode].strip(chr(10))}"
        )
    return "\n\n".join(chunks) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(ROOT))
    parser.add_argument("--output-dir", default="work/r15/build")
    parser.add_argument("--full-omnibus", default="dist/合本_絶頂鑑定_完全版_全57話.txt")
    parser.add_argument("--r15-omnibus", default="dist/合本_絶頂鑑定_R15版_全57話.txt")
    parser.add_argument("--check", action="store_true", help="既存成果物と比較し、書き換えない")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    output_dir = root / args.output_dir
    full_path = root / args.full_omnibus
    r15_path = root / args.r15_omnibus
    try:
        titles = parse_titles(root / "work/r15/titles.tsv")
        manifest = parse_manifest(root / "work/r15/manifest.tsv")
        drafts = sorted((root / "work/drafts").glob("episode[0-9][0-9][0-9].txt"))
        full_bodies: dict[str, str] = {}
        r15_bodies: dict[str, str] = {}
        for path in drafts:
            match = EPISODE_RE.fullmatch(path.name)
            assert match is not None
            episode = match.group(1)
            if episode not in titles:
                raise ValueError(f"話名がない: ep{episode}")
            full_bodies[episode] = read_text(path).rstrip("\n") + "\n"
            r15_bodies[episode] = build_episode(
                full_bodies[episode], manifest.get(episode, []), root / "work/r15/bridges"
            )
        if set(titles) != set(full_bodies):
            missing = sorted(set(titles) - set(full_bodies))
            raise ValueError(f"本文がない話: {', '.join(missing)}")

        full_book = omnibus(
            read_text(root / "work/r15/frontmatter-full.txt"), titles, full_bodies, r15=False
        )
        r15_book = omnibus(
            read_text(root / "work/r15/frontmatter-r15.txt"), titles, r15_bodies, r15=True
        )
    except (OSError, ValueError, csv.Error) as exc:
        print(f"生成不能: {exc}", file=sys.stderr)
        return 2

    outputs = {
        **{output_dir / f"episode{episode}.txt": body for episode, body in r15_bodies.items()},
        full_path: full_book,
        r15_path: r15_book,
    }
    if args.check:
        mismatches = [
            path for path, expected in outputs.items()
            if not path.is_file() or read_text(path) != expected
        ]
        for path in mismatches:
            print(f"不一致: {path.relative_to(root)}")
        if mismatches:
            print(f"R15成果物: 不一致 {len(mismatches)}件")
            return 1
        print(f"R15成果物: {len(r15_bodies)}話＋二版合本が正本と一致")
        return 0

    output_dir.mkdir(parents=True, exist_ok=True)
    full_path.parent.mkdir(parents=True, exist_ok=True)
    for path, content in outputs.items():
        path.write_text(content, encoding="utf-8", newline="\n")
    print(f"R15成果物: {len(r15_bodies)}話＋二版合本を生成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
