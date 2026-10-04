#!/usr/bin/env python3
"""再生成候補から1枚を page-NN.png に確定し、他の候補を消す。

nai_generate.py --count N（N>=2）は page-NN.png を上書きせず
page-NN-1.png … page-NN-N.png を足す。確定はこのスクリプト。
トークンは使わない。
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
TAKE_NAME = re.compile(r"^page-(\d+)-(\d+)\.png$", re.I)


def page_dir(path: Path) -> Path:
    if path.is_file():
        raise SystemExit(f"ディレクトリを指定してください: {path}")
    if not path.is_dir():
        raise SystemExit(f"ディレクトリがありません: {path}")
    return path


def canon_path(out_dir: Path, page: int) -> Path:
    return out_dir / f"page-{page:02d}.png"


def take_paths(out_dir: Path, page: int) -> list[tuple[int, Path]]:
    found: list[tuple[int, Path]] = []
    for p in out_dir.iterdir():
        m = TAKE_NAME.match(p.name)
        if not m:
            continue
        if int(m.group(1)) != page:
            continue
        found.append((int(m.group(2)), p))
    found.sort(key=lambda x: x[0])
    return found


def list_page(out_dir: Path, page: int) -> int:
    canon = canon_path(out_dir, page)
    takes = take_paths(out_dir, page)
    print(f"ページ{page}: {out_dir}")
    if canon.is_file():
        print(f"  canonical  {canon.name}")
    else:
        print("  canonical  (なし)")
    if not takes:
        print("  候補        (なし)")
        return 0
    for n, p in takes:
        print(f"  take {n:<7} {p.name}")
    return 0


def adopt(out_dir: Path, page: int, take: str) -> int:
    canon = canon_path(out_dir, page)
    takes = take_paths(out_dir, page)
    if take in {"canonical", "0", "orig", "original"}:
        if not canon.is_file():
            raise SystemExit(f"確定元がありません: {canon.name}")
        src = None
        label = "canonical"
    else:
        try:
            n = int(take)
        except ValueError:
            raise SystemExit("--take は番号か canonical にしてください。") from None
        match = [p for num, p in takes if num == n]
        if not match:
            raise SystemExit(f"候補がありません: page-{page:02d}-{n}.png")
        src = match[0]
        label = src.name
        shutil.copy2(src, canon)
    for _, p in takes:
        p.unlink()
    print(f"確定 ページ{page}: {label} → {canon.name}")
    print(f"削除 候補 {len(takes)} 枚")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="再生成候補を1枚だけ page-NN.png に残し、他を消す"
    )
    parser.add_argument(
        "--dir",
        default=None,
        help="生成フォルダ。省略時は work/generated/<stem>/ を --stem から",
    )
    parser.add_argument("--stem", default=None, help="プロンプトmdのstem。--dir より簡易")
    parser.add_argument("--page", type=int, required=True, help="ページ番号")
    parser.add_argument(
        "--take",
        default=None,
        help="採用する候補番号。canonical で現行の page-NN.png を残す",
    )
    parser.add_argument("--list", action="store_true", help="候補だけ出す")
    args = parser.parse_args()
    if args.dir:
        out_dir = page_dir(Path(args.dir))
    elif args.stem:
        out_dir = page_dir(ROOT / "work" / "generated" / args.stem)
    else:
        raise SystemExit("--dir か --stem を指定してください。")
    if args.page < 1:
        raise SystemExit("--page は1以上にしてください。")
    if args.list or args.take is None:
        return list_page(out_dir, args.page)
    return adopt(out_dir, args.page, args.take)


if __name__ == "__main__":
    sys.exit(main())
