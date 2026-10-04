#!/usr/bin/env python3
"""挿絵マーカー付き小説本文を、実画像埋め込みPDFへ変換する。

既定レイアウト:
  - 左右余白を狭くし、本文・挿絵をページ横幅いっぱいに使う
  - 行幅は余白内に収まる全角換算文字数（文字サイズ固定時は文字数が増える）
  - 地の文の段落冒頭は全角1字下げ。『』「」で始まる台詞行は字下げしない
  - 挿絵は本文幅いっぱい（縦横比維持）。番号・説明文は出さない

依存: reportlab, Pillow（リポジトリの .venv-pdf を推奨）
"""

from __future__ import annotations

import argparse
import math
import re
import sys
import unicodedata
from pathlib import Path

from PIL import Image as PILImage
from reportlab.lib.pagesizes import A5
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


MARKER_RE = re.compile(
    r"^[ 　]*［\s*挿絵\s*[：:]\s*(.+?)\s*］[ 　]*$"
)

# --- 確定仕様（illust-novel-pdf。ユーザー承認済み。無断で変えない）---
DEFAULT_PAGE_SIZE = A5
DEFAULT_FONT_SIZE = 11.0
DEFAULT_LINE_GAP = 1.55
DEFAULT_MARGIN_SIDE_MM = 8.0   # 左右余白 mm
DEFAULT_MARGIN_VERT_MM = 12.0  # 上下余白 mm
# chars 未指定時は「左右余白内に収まる最大全角数」を自動計算（字サイズ固定）
DEFAULT_CHARS: float | None = None


def die(message: str, code: int = 2) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(code)


def char_units(ch: str) -> float:
    """全角=1、半角相当=0.5。"""
    if ch in "\t":
        return 2.0
    ea = unicodedata.east_asian_width(ch)
    if ea in ("F", "W", "A"):
        return 1.0
    return 0.5


def wrap_line(text: str, max_units: float) -> list[str]:
    if not text:
        return [""]
    lines: list[str] = []
    buf: list[str] = []
    width = 0.0
    for ch in text:
        u = char_units(ch)
        if buf and width + u > max_units + 1e-9:
            lines.append("".join(buf))
            buf = [ch]
            width = u
        else:
            buf.append(ch)
            width += u
    if buf:
        lines.append("".join(buf))
    return lines


def is_dialogue_line(text: str) -> bool:
    """台詞行（字下げ厳禁）。"""
    s = text.lstrip(" 　")
    return s.startswith("「") or s.startswith("『")


def paragraph_lines(text: str, max_units: float) -> list[str]:
    """地の文は冒頭全角1字下げ、台詞は字下げなし。"""
    stripped = text.lstrip(" 　")
    if not stripped:
        return [""]
    if is_dialogue_line(stripped):
        return wrap_line(stripped, max_units)
    # 既に字下げ済みなら二重にしない
    if text.startswith("　") or text.startswith(" "):
        body = stripped
    else:
        body = stripped
    # 全角スペース1つを先頭に付けて折返し（1字下げ）
    return wrap_line("　" + body, max_units)


def register_font(font_path: Path, face_name: str = "NovelJP") -> str:
    try:
        if font_path.suffix.lower() == ".ttc":
            pdfmetrics.registerFont(TTFont(face_name, str(font_path), subfontIndex=0))
        else:
            pdfmetrics.registerFont(TTFont(face_name, str(font_path)))
    except Exception as exc:  # noqa: BLE001
        die(f"フォント登録に失敗: {font_path}: {exc}")
    return face_name


def resolve_image(token: str, image_dir: Path, text_path: Path) -> Path | None:
    token = token.strip().strip("\"'")
    candidates: list[Path] = []
    raw = Path(token)
    if raw.is_absolute() and raw.is_file():
        return raw
    candidates.append((text_path.parent / token).resolve())
    candidates.append((image_dir / token).resolve())
    candidates.append((image_dir / Path(token).name).resolve())
    stem = Path(token).name
    if "." not in stem:
        for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".JPG", ".PNG"):
            candidates.append((image_dir / f"{stem}{ext}").resolve())
            if stem.isdigit():
                candidates.append((image_dir / f"{stem.zfill(2)}{ext}").resolve())
                candidates.append((image_dir / f"{stem.zfill(3)}{ext}").resolve())
    for path in candidates:
        if path.is_file():
            return path
    return None


def parse_blocks(text: str) -> list[tuple[str, str]]:
    blocks: list[tuple[str, str]] = []
    for raw in text.splitlines():
        line = raw.rstrip("\n\r")
        m = MARKER_RE.match(line)
        if m:
            blocks.append(("image", m.group(1).strip()))
        else:
            blocks.append(("text", line))
    return blocks


def draw_text_line(
    c: canvas.Canvas,
    line: str,
    x: float,
    y: float,
    font_name: str,
    font_size: float,
) -> None:
    c.setFont(font_name, font_size)
    c.drawString(x, y - font_size * 0.8, line)


def pick_font(font_path: Path | None) -> tuple[Path, str]:
    font_name = "NovelJP"
    if font_path is not None:
        return font_path, register_font(font_path, font_name)

    last_err = ""
    candidates = [
        Path("/mnt/c/Windows/Fonts/YuGothR.ttc"),
        Path("/mnt/c/Windows/Fonts/YuGothM.ttc"),
        Path("/mnt/c/Windows/Fonts/meiryo.ttc"),
        Path("/mnt/c/Windows/Fonts/msgothic.ttc"),
        Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
        Path.home() / ".local/share/fonts/NotoSansCJKjp-Regular.otf",
    ]
    for cand in candidates:
        if not cand.is_file():
            continue
        try:
            if cand.suffix.lower() == ".ttc":
                pdfmetrics.registerFont(TTFont(font_name, str(cand), subfontIndex=0))
            else:
                pdfmetrics.registerFont(TTFont(font_name, str(cand)))
            return cand, font_name
        except Exception as exc:  # noqa: BLE001
            last_err = f"{cand}: {exc}"
            continue
    die(
        "日本語フォントを登録できない。"
        f" 最後のエラー: {last_err or '候補なし'}。"
        " --font で TrueType/TTC を指定する。"
    )


def build_pdf(
    text_path: Path,
    image_dir: Path,
    out_path: Path,
    *,
    chars: float | None = DEFAULT_CHARS,
    font_size: float = DEFAULT_FONT_SIZE,
    font_path: Path | None = None,
    page_size: tuple[float, float] = DEFAULT_PAGE_SIZE,
    margin_side_mm: float = DEFAULT_MARGIN_SIDE_MM,
    margin_vert_mm: float = DEFAULT_MARGIN_VERT_MM,
) -> dict:
    font_file, font_name = pick_font(font_path)

    page_w, page_h = page_size
    margin_side = margin_side_mm * mm
    margin_top = margin_vert_mm * mm
    margin_bottom = margin_vert_mm * mm

    # 本文・挿絵は左右余白を除いた幅いっぱい
    content_w = page_w - 2 * margin_side
    if content_w <= font_size * 8:
        die("左右余白が広すぎて本文幅が足りない。--margin-side-mm を小さくする。")

    if chars is None:
        # 全角1文字 ≈ font_size pt。余白内に収まる最大文字数
        chars = math.floor(content_w / font_size)
    else:
        # 指定文字数が幅を超える場合はフォントは維持し、幅に合わせて文字数を落とす
        max_chars = math.floor(content_w / font_size)
        if chars > max_chars:
            chars = float(max_chars)

    # 実際の描画幅は「文字数×字送り」と「余白内最大幅」の大きい方を本文枠とする
    # → 挿絵も同じ枠いっぱい。字送りは font_size 固定。
    text_block_w = min(content_w, chars * font_size)
    # ユーザー要望: 横に広げる → 余白内最大幅を本文・挿絵の枠にする
    text_block_w = content_w
    # 折返し文字数は枠に合わせて再計算（字サイズは維持）
    chars = math.floor(text_block_w / font_size)

    x0 = margin_side
    line_h = font_size * DEFAULT_LINE_GAP
    para_gap = font_size * 0.45

    body = text_path.read_text(encoding="utf-8")
    blocks = parse_blocks(body)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(out_path), pagesize=page_size)
    c.setTitle(text_path.stem)
    y = page_h - margin_top
    page_count = 1

    missing: list[str] = []
    image_count = 0
    text_lines_drawn = 0

    def new_page() -> float:
        nonlocal page_count
        c.showPage()
        page_count += 1
        return page_h - margin_top

    def need(height: float) -> None:
        nonlocal y
        if y - height < margin_bottom:
            y = new_page()

    for kind, payload in blocks:
        if kind == "text":
            if payload.strip() == "":
                if text_lines_drawn == 0 and abs(y - (page_h - margin_top)) < 1e-6:
                    continue
                need(para_gap)
                y -= para_gap
                continue
            for wrapped in paragraph_lines(payload, chars):
                need(line_h)
                draw_text_line(c, wrapped, x0, y, font_name, font_size)
                y -= line_h
                text_lines_drawn += 1
            continue

        token = payload
        img_path = resolve_image(token, image_dir, text_path)
        if img_path is None:
            missing.append(token)
            need(line_h * 0.5)
            y -= line_h * 0.5
            continue

        gap = font_size * 0.8
        need(gap)
        y -= gap

        max_h = page_h - margin_top - margin_bottom
        with PILImage.open(img_path) as im:
            iw, ih = im.size
        if iw <= 0 or ih <= 0:
            missing.append(token)
            continue

        def fit_image() -> tuple[float, float, float]:
            width = text_block_w
            height = text_block_w * (ih / float(iw))
            if height > max_h:
                scale = max_h / height
                height = max_h
                width = text_block_w * scale
                left = x0 + (text_block_w - width) / 2.0
            else:
                left = x0
            return left, width, height

        img_x, w, h = fit_image()
        if y - h - gap < margin_bottom:
            y = new_page()
            img_x, w, h = fit_image()

        mask = "auto" if img_path.suffix.lower() == ".png" else None
        c.drawImage(
            str(img_path),
            img_x,
            y - h,
            width=w,
            height=h,
            preserveAspectRatio=True,
            anchor="c",
            mask=mask,
        )
        y -= h
        y -= gap
        image_count += 1

    c.save()
    return {
        "out": str(out_path),
        "pages": page_count,
        "images": image_count,
        "missing": missing,
        "font": str(font_file),
        "font_size": font_size,
        "content_width_pt": text_block_w,
        "chars": chars,
        "margin_side_mm": margin_side_mm,
        "margin_vert_mm": margin_vert_mm,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("text", type=Path, help="挿絵マーカー付き本文 .txt")
    parser.add_argument(
        "--images",
        type=Path,
        required=True,
        help="挿絵画像フォルダ（［挿絵：01］をここで解決）",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="出力PDF（既定: 本文と同じ stem の .pdf）",
    )
    parser.add_argument(
        "--chars",
        type=float,
        default=None,
        help="全角換算の行幅（省略時は左右余白内に収まる最大文字数）",
    )
    parser.add_argument("--font-size", type=float, default=DEFAULT_FONT_SIZE, help="本文pt")
    parser.add_argument("--font", type=Path, default=None, help="日本語フォントファイル")
    parser.add_argument(
        "--margin-side-mm",
        type=float,
        default=DEFAULT_MARGIN_SIDE_MM,
        help="左右余白mm（既定8）",
    )
    parser.add_argument(
        "--margin-vert-mm",
        type=float,
        default=DEFAULT_MARGIN_VERT_MM,
        help="上下余白mm（既定12）",
    )
    # 後方互換
    parser.add_argument(
        "--margin-mm",
        type=float,
        default=None,
        help="上下左右を同じmmにする（指定時は side/vert より優先）",
    )
    args = parser.parse_args(argv)

    text_path = args.text.resolve()
    image_dir = args.images.resolve()
    if not text_path.is_file():
        die(f"本文が無い: {text_path}")
    if not image_dir.is_dir():
        die(f"画像フォルダが無い: {image_dir}")

    out_path = args.output
    if out_path is None:
        out_path = text_path.with_suffix(".pdf")
    out_path = out_path.resolve()

    side = args.margin_side_mm
    vert = args.margin_vert_mm
    if args.margin_mm is not None:
        side = args.margin_mm
        vert = args.margin_mm

    info = build_pdf(
        text_path,
        image_dir,
        out_path,
        chars=args.chars,
        font_size=args.font_size,
        font_path=args.font.resolve() if args.font else None,
        margin_side_mm=side,
        margin_vert_mm=vert,
    )
    print(f"PDF: {info['out']}")
    print(
        f"pages≈{info['pages']} images={info['images']} "
        f"chars/line={info['chars']} font_size={info['font_size']:.2f} "
        f"margin_side={info['margin_side_mm']}mm"
    )
    if info["missing"]:
        print("missing images:", ", ".join(info["missing"]), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
