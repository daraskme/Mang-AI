#!/usr/bin/env python3
"""Skill出力のMarkdownをNovelAI公式画像APIへ送る。

トークンは環境変数 NOVELAI_API_TOKEN、またはリポジトリ直下の .env。
チャットやログにトークンを出さない。
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
API_URL = "https://image.novelai.net/ai/generate-image"
DEFAULT_MODEL = "nai-diffusion-5-full"
SAMPLERS = {
    "euler ancestral": "k_euler_ancestral",
    "euler": "k_euler",
    "dpm++ 2s ancestral": "k_dpmpp_2s_ancestral",
    "dpm++ 2m sde": "k_dpmpp_2m_sde",
    "dpm++ 2m": "k_dpmpp_2m",
    "dpm++ sde": "k_dpmpp_sde",
}
# V5 UI順。community SDK (caru-ini/novelai-sdk) と同じ。
UC_PRESET = {
    "強い": 0,
    "heavy": 0,
    "軽い": 1,
    "light": 1,
    "ケモノモード": 2,
    "furry": 2,
    "人間に重点を置く": 3,
    "human": 3,
    "human focus": 3,
    "指定なし": 4,
    "なし": 4,
    "none": 4,
}
# 配置文の位置語 → キャンバス百分率（左上原点）。ピンはキャラごとであり、コマの段ではない。
LAYOUT_COORDS = {
    "上段左端": (18, 18),
    "上段右端": (82, 18),
    "上段左": (22, 22),
    "上段右": (78, 22),
    "下段左": (25, 78),
    "下段右": (75, 78),
    "左下": (25, 78),
    "右下": (75, 78),
    "左上": (22, 22),
    "右上": (78, 22),
    "上段": (50, 28),
    "中段": (50, 50),
    "下段": (50, 78),
    "中央": (50, 50),
    "上": (50, 28),
    "中": (50, 50),
    "下": (50, 78),
    "左": (25, 50),
    "右": (75, 50),
}

PAGE_HEAD = re.compile(r"^## ページ(\d+)", re.M)
FENCE = re.compile(
    r"^###[ \t]*(Base|Undesired Content|Character[ \t]+(\d+))\s*$"
    r"\n+```(?:text)?\n(.*?)\n```",
    re.M | re.S,
)
SETTING_LINE = re.compile(r"^[-*]\s*([^:：]+)[:：]\s*(.+)$", re.M)
PIN_ROW = re.compile(
    r"^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*(オン|オフ|有効|無効)\s*\|"
    r"[^|]*\|\s*(\d+)\s*\|\s*(\d+)\s*\|",
    re.M,
)
NAME_ROW = re.compile(r"^\|\s*(\d+)\s*\|[^|\n]*\|\s*(W[1-8])\s*\|", re.M)
LAYOUT_RE = re.compile(
    r"Character[ \t]+(\d+)\s*(?:は\s*)?"
    r"(上段左端|上段右端|上段左|上段右|下段左|下段右|左下|右下|左上|右上|"
    r"上段|中段|下段|中央|上|中|下|左|右)"
)
QUOTE_RE = re.compile(r"「([^」]+)」")
SFX_RE = re.compile(r"sfx「([^」]*)」")
CJK_RE = re.compile(r"[\u3040-\u30ff\u4e00-\u9fff]")


def load_token() -> str:
    env_path = ROOT / ".env"
    if env_path.is_file():
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            if key.strip() == "NOVELAI_API_TOKEN":
                token = value.strip().strip("'\"")
                if token:
                    os.environ.setdefault("NOVELAI_API_TOKEN", token)
    token = os.environ.get("NOVELAI_API_TOKEN", "").strip()
    if not token:
        raise SystemExit(
            "NOVELAI_API_TOKEN がありません。"
            " templates/nai-api.env.example を .env にコピーしてトークンを入れてください。"
        )
    if token.startswith("pst-ここに") or "貼る" in token:
        raise SystemExit(".env のトークンが雛形のままです。Persistent API Token に差し替えてください。")
    return token


def parse_settings(text: str) -> dict:
    settings = {
        "model": DEFAULT_MODEL,
        "quality_toggle": False,
        "uc_preset": None,
        "width": 832,
        "height": 1216,
        "steps": 23,
        "scale": 5.0,
        "sampler": "k_euler_ancestral",
        "furry": False,
        "use_coords": True,
        "text_mode": "",
    }
    block = ""
    if "## 設定" in text:
        rest = text.split("## 設定", 1)[1]
        nxt = re.search(r"^## ", rest, re.M)
        block = rest[: nxt.start()] if nxt else rest
    for match in SETTING_LINE.finditer(block):
        key = match.group(1).strip()
        val = match.group(2).strip()
        if key == "モデル":
            low = val.lower()
            if "curated" in low:
                settings["model"] = "nai-diffusion-5-curated"
            else:
                settings["model"] = DEFAULT_MODEL
        elif key == "モード":
            settings["furry"] = "ケモノ" in val
        elif key == "Quality Tags":
            settings["quality_toggle"] = val not in ("指定なし", "なし", "off", "OFF")
        elif key == "UC Preset":
            low = val.lower()
            if val in UC_PRESET:
                settings["uc_preset"] = UC_PRESET[val]
            elif low in UC_PRESET:
                settings["uc_preset"] = UC_PRESET[low]
            elif val.isdigit():
                settings["uc_preset"] = int(val)
            else:
                settings["uc_preset"] = 4
        elif key == "位置":
            settings["use_coords"] = "カスタム" in val
        elif key == "解像度":
            found = re.search(r"(\d+)\s*[×x]\s*(\d+)", val)
            if found:
                settings["width"] = int(found.group(1))
                settings["height"] = int(found.group(2))
        elif key == "ステップ":
            digits = re.search(r"\d+", val)
            if digits:
                settings["steps"] = int(digits.group())
        elif key == "プロンプトガイダンス":
            try:
                settings["scale"] = float(val.split()[0])
            except ValueError:
                pass
        elif key == "サンプラー":
            settings["sampler"] = SAMPLERS.get(val.lower(), "k_euler_ancestral")
        elif key == "Text mode":
            settings["text_mode"] = val
    return settings


def parse_pins(block: str) -> dict[int, tuple[float, float, bool]]:
    pins: dict[int, tuple[float, float, bool]] = {}
    for match in PIN_ROW.finditer(block):
        idx = int(match.group(1))
        enabled = match.group(3) in ("オン", "有効")
        x = int(match.group(4)) / 100.0
        y = int(match.group(5)) / 100.0
        pins[idx] = (x, y, enabled)
    return pins


def parse_layout_prose(block: str) -> dict[int, tuple[float, float, bool]]:
    pins: dict[int, tuple[float, float, bool]] = {}
    for match in LAYOUT_RE.finditer(block):
        idx = int(match.group(1))
        label = match.group(2)
        x, y = LAYOUT_COORDS[label]
        pins[idx] = (x / 100.0, y / 100.0, True)
    return pins


def default_centers(count: int) -> list[tuple[float, float]]:
    if count <= 1:
        return [(0.5, 0.5)]
    if count == 2:
        return [(0.35, 0.5), (0.65, 0.5)]
    xs = [0.25, 0.5, 0.75, 0.25, 0.75]
    ys = [0.3, 0.5, 0.3, 0.7, 0.7]
    return list(zip(xs, ys))[:count]


def parse_name_templates(text: str) -> dict[int, str]:
    templates: dict[int, str] = {}
    heading = "## 画面" if "## 画面" in text else "## ネーム" if "## ネーム" in text else ""
    if not heading:
        return templates
    rest = text.split(heading, 1)[1]
    nxt = re.search(r"^## ", rest, re.M)
    block = rest[: nxt.start()] if nxt else rest
    for match in NAME_ROW.finditer(block):
        templates[int(match.group(1))] = match.group(2)
    return templates


def parse_pages(text: str) -> list[dict]:
    heads = list(PAGE_HEAD.finditer(text))
    chunks: list[tuple[int, str]]
    if heads:
        chunks = []
        for i, match in enumerate(heads):
            end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
            chunks.append((int(match.group(1)), text[match.start() : end]))
    else:
        chunks = [(1, text)]

    pages = []
    for number, block in chunks:
        fields = {"base": "", "uc": "", "characters": []}
        chars: dict[int, str] = {}
        for match in FENCE.finditer(block):
            title = match.group(1)
            body = match.group(3).strip()
            if title == "Base":
                fields["base"] = body
            elif title == "Undesired Content":
                fields["uc"] = body
            elif match.group(2):
                chars[int(match.group(2))] = body
        fields["characters"] = [chars[i] for i in sorted(chars)]
        fields["raw"] = block
        table = parse_pins(block)
        prose = parse_layout_prose(block)
        fields["pins"] = table or prose
        fields["number"] = number
        if table:
            fields["pin_source"] = "table"
        elif prose:
            fields["pin_source"] = "prose"
        else:
            fields["pin_source"] = ""
        if fields["base"]:
            pages.append(fields)
    if not pages:
        raise SystemExit("Base コードブロックが見つかりません。nai-v5-prompt-designer の出力形式か確認してください。")
    return pages


def validate_contract(text: str, settings: dict, pages: list[dict]) -> tuple[list[str], list[str]]:
    """Output_Contract.md の機械検査。errors は失敗、warnings は続行可。"""
    errors: list[str] = []
    warnings: list[str] = []
    if "## 設定" not in text:
        errors.append("## 設定 が無い")
    if not PAGE_HEAD.search(text):
        warnings.append("## ページN が無い（契約は ## ページ1 から）")
    for page in pages:
        number = page["number"]
        raw = page.get("raw") or ""
        if not re.search(r"^###[ \t]*Base\s*$", raw, re.M):
            errors.append(f"ページ{number}: ### Base 見出しが無い（Base: ラベルは契約外）")
        if not re.search(r"^###[ \t]*Undesired Content\s*$", raw, re.M):
            warnings.append(f"ページ{number}: ### Undesired Content 見出しが無い")
        if settings.get("use_coords") and page.get("pin_source") != "table":
            warnings.append(
                f"ページ{number}: ## 配置 のピン表が無い（位置 {page.get('pin_source') or 'default'}）"
            )
        for i, prompt in enumerate(page.get("characters") or [], start=1):
            first = prompt.splitlines()[0] if prompt else ""
            if re.search(r"(?i)(?:^|,)\s*text:", first):
                warnings.append(
                    f"ページ{number} Character {i}: タグ行に text:（R-TXT-01。末尾は「」）"
                )
            leftover = QUOTE_RE.sub("", SFX_RE.sub("", prompt))
            leftover = re.sub(r"(?m)^Text:.*$", "", leftover)
            if CJK_RE.search(leftover):
                warnings.append(
                    f"ページ{number} Character {i}: 「」の外に日本語（R-TAG-02）"
                )
    return errors, warnings


TEXT_INLINE = re.compile(r"(?:,\s*)?text:\s*(.+)$", re.I)
TAG_NOISE = re.compile(
    r"(?i)\b(?:speech bubble|thought bubble|open mouth|japanese text|text:)\b\s*,?\s*"
)


def _clean_quote(quote: str) -> str:
    quote = quote.strip().strip("「」")
    quote = TAG_NOISE.sub("", quote)
    quote = re.sub(r",\s*,", ",", quote).strip(" ,「」")
    return quote


def _expand_sfx(prompt: str) -> str:
    """擬音の sfx「」は Text: に入れない。吹き出しと描き文字が混ざる。"""

    def repl(match: re.Match) -> str:
        word = match.group(1).strip()
        if not word:
            return ""
        return f'free-standing handwritten manga sound effect text "{word}"'

    return SFX_RE.sub(repl, prompt)


def append_text_block(prompt: str) -> str:
    """タグとセリフを分ける。フキダシ本文は末尾の Text: だけに置く。

    `text:` をタグと同じ行に残すと、speech bubble 等の英語が描き文字になる。
    `sfx「」` はプロンプト本体に残し、Text: からは外す（R-TXT-06）。
    """
    prompt = _expand_sfx(prompt.strip())
    if re.search(r"(?m)^Text:", prompt):
        return prompt + "\n"
    quotes = [_clean_quote(q) for q in QUOTE_RE.findall(prompt)]
    quotes = [q for q in quotes if q]
    if quotes:
        tags = QUOTE_RE.sub("", prompt)
        tags = re.sub(r",\s*,", ",", tags).strip(" ,")
        return _join_text_lines(tags, quotes)
    found = TEXT_INLINE.search(prompt)
    if found:
        dialogue = _clean_quote(found.group(1))
        tags = prompt[: found.start()].rstrip(" ,")
        return _join_text_lines(tags, [dialogue] if dialogue else [])
    return prompt + "\n"


def _join_text_lines(tags: str, quotes: list[str]) -> str:
    if not quotes:
        return tags.rstrip() + "\n"
    lines = [tags.rstrip(), ""]
    for i, quote in enumerate(quotes):
        # 2つ目以降に Text: を繰り返すと、フキダシ先頭に T / 1 が描かれる
        prefix = "Text: " if i == 0 else ""
        lines.append(f"{prefix}{quote}")
        if i + 1 < len(quotes):
            lines.append("")
    return "\n".join(lines) + "\n"


def resolve_centers(page: dict, templates: dict[int, str]) -> tuple[list, str]:
    del templates
    chars = page["characters"]
    pins = page["pins"]
    source = page.get("pin_source") or ("table" if pins else "default")
    if pins:
        centers = []
        for i, _prompt in enumerate(chars, start=1):
            if i in pins:
                x, y, enabled = pins[i]
                centers.append(None if not enabled else (x, y))
            else:
                fallback = default_centers(len(chars) or 1)
                centers.append(fallback[min(i - 1, len(fallback) - 1)])
        return centers, source
    defaults = default_centers(len(chars) or 1)
    return list(defaults[: len(chars) or 1]), "default"


def build_payload(settings: dict, page: dict, templates: dict[int, str] | None = None) -> dict:
    templates = templates or {}
    chars = page["characters"]
    centers, pin_source = resolve_centers(page, templates)
    page["pin_source"] = pin_source
    char_prompts = []
    char_captions = []
    neg_captions = []
    for i, prompt in enumerate(chars, start=1):
        center = centers[i - 1] if i - 1 < len(centers) else None
        if center is None:
            continue
        x, y = center
        lettered = append_text_block(prompt).strip()
        char_prompts.append(
            {
                "prompt": lettered,
                "uc": "",
                "center": {"x": round(x, 4), "y": round(y, 4)},
                "enabled": True,
            }
        )
        char_captions.append(
            {"char_caption": lettered, "centers": [{"x": round(x, 4), "y": round(y, 4)}]}
        )
        neg_captions.append({"char_caption": "", "centers": [{"x": round(x, 4), "y": round(y, 4)}]})

    base = append_text_block(page["base"])
    use_coords = bool(char_prompts) and settings.get("use_coords", True)
    if pin_source == "default":
        use_coords = False
    uc_preset = settings.get("uc_preset")
    if uc_preset is None:
        uc_preset = 4
    parameters = {
        "params_version": 3,
        "width": settings["width"],
        "height": settings["height"],
        "scale": settings["scale"],
        "sampler": settings["sampler"],
        "steps": settings["steps"],
        "n_samples": 1,
        "ucPreset": uc_preset,
        "qualityToggle": settings["quality_toggle"],
        "negative_prompt": page["uc"],
        "cfg_rescale": 0,
        "use_coords": use_coords,
        "legacy": False,
        "legacy_uc": False,
        "legacy_v3_extend": False,
        "autoSmea": False,
        "sm": False,
        "sm_dyn": False,
        "dynamic_thresholding": False,
        "deliberate_euler_ancestral_bug": False,
        "prefer_brownian": True,
        "characterPrompts": char_prompts,
        "v4_prompt": {
            "caption": {"base_caption": base.strip(), "char_captions": char_captions},
            "use_coords": use_coords,
            "use_order": True,
        },
        "v4_negative_prompt": {
            "caption": {
                "base_caption": page["uc"],
                "char_captions": neg_captions,
            },
            "legacy_uc": False,
        },
    }
    payload = {
        "input": base.strip(),
        "model": settings["model"],
        "action": "generate",
        "parameters": parameters,
    }
    return payload


def request_image(token: str, payload: dict, timeout: int) -> bytes:
    raw = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=raw,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/x-zip-compressed, application/json, */*",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            "Origin": "https://novelai.net",
            "Referer": "https://novelai.net/",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:2000]
        raise SystemExit(f"API {exc.code}: {detail}") from None


PNG_SIG = b"\x89PNG\r\n\x1a\n"


def extract_pngs(blob: bytes) -> list[bytes]:
    if blob.startswith(PNG_SIG):
        return [blob]
    if blob[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(blob)) as zf:
            names = [n for n in zf.namelist() if n.lower().endswith(".png")]
            if not names:
                raise SystemExit("ZIPにPNGがありません。")
            return [zf.read(name) for name in names]
    text = blob.lstrip()
    if text.startswith(b"{") or text.startswith(b"["):
        try:
            obj = json.loads(text)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"画像応答がJSONとして読めません: {exc}") from None
        images = obj.get("images") if isinstance(obj, dict) else obj
        if not isinstance(images, list) or not images:
            raise SystemExit(f"画像応答の形式が不明です: {list(obj)[:8] if isinstance(obj, dict) else type(obj)}")
        pngs: list[bytes] = []
        for item in images:
            b64 = item.get("image") if isinstance(item, dict) else item
            if not isinstance(b64, str) or not b64:
                continue
            if "," in b64[:40] and b64.strip().startswith("data:"):
                b64 = b64.split(",", 1)[1]
            png = base64.b64decode(b64)
            if not png.startswith(PNG_SIG):
                raise SystemExit("Base64を戻してもPNGではありません。")
            pngs.append(png)
        if not pngs:
            raise SystemExit("JSON応答に画像がありません。")
        return pngs
    raise SystemExit(f"未対応の画像応答です（先頭: {blob[:24]!r}）")


def save_zip_pngs(blob: bytes, dest: Path, stem: str) -> list[Path]:
    dest.mkdir(parents=True, exist_ok=True)
    pngs = extract_pngs(blob)
    written: list[Path] = []
    for i, png in enumerate(pngs, start=1):
        out = dest / (f"{stem}.png" if len(pngs) == 1 else f"{stem}-{i}.png")
        out.write_bytes(png)
        written.append(out)
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description="NovelAI公式APIでSkillのMarkdownから生成する")
    parser.add_argument("markdown", help="nai-v5-prompt-designer の出力.md")
    parser.add_argument("--out-dir", default=None, help="保存先。省略時は work/generated/<stem>/")
    parser.add_argument("--page", type=int, action="append", help="生成するページ番号。複数可")
    parser.add_argument("--model", default=None, help="上書き。既定は設定欄または nai-diffusion-5-full")
    parser.add_argument("--sleep", type=float, default=2.0, help="連続生成の間隔秒")
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--dry-run", action="store_true", help="送信せずジョブ内容だけ出す")
    parser.add_argument("--skip-existing", action="store_true", help="既存の page-NN.png を飛ばす")
    parser.add_argument(
        "--count",
        type=int,
        default=1,
        help="各ページの生成回数。1は page-NN.png を書く（上書き）。2以上は page-NN.png を残し page-NN-1.png 以降。再生成の上限は3",
    )
    parser.add_argument("--seed", type=int, default=None, help="シード固定。省略時はAPI側の乱数")
    args = parser.parse_args()
    if args.count < 1:
        raise SystemExit("--count は1以上にしてください。")
    if args.count > 3:
        raise SystemExit("--count の上限は3です（再生成は画面あたり3回まで）。")

    md_path = Path(args.markdown)
    if not md_path.is_file():
        raise SystemExit(f"ファイルがありません: {md_path}")
    text = md_path.read_text(encoding="utf-8")
    settings = parse_settings(text)
    if args.model:
        settings["model"] = args.model
    pages = parse_pages(text)
    contract_errors, contract_warnings = validate_contract(text, settings, pages)
    for item in contract_warnings:
        print(f"契約警告: {item}")
    if contract_errors:
        for item in contract_errors:
            print(f"契約違反: {item}", file=sys.stderr)
        raise SystemExit("Output_Contract に違反しています。references/Output_Contract.md を見て直してください。")
    templates = parse_name_templates(text)
    if args.page:
        wanted = set(args.page)
        pages = [p for p in pages if p["number"] in wanted]
        if not pages:
            raise SystemExit("指定ページがMarkdownにありません。")

    out_dir = Path(args.out_dir) if args.out_dir else ROOT / "work" / "generated" / md_path.stem

    print(f"入力: {md_path}")
    print(f"モデル: {settings['model']}")
    print(f"解像度: {settings['width']}x{settings['height']} / ステップ {settings['steps']} / ガイダンス {settings['scale']}")
    print(f"Quality Tags: {'標準相当' if settings['quality_toggle'] else '指定なし'}")
    print(f"UC Preset: {settings.get('uc_preset', 4)}")
    print(f"ページ数: {len(pages)}")
    print(f"各ページの回数: {args.count}")

    if args.dry_run:
        payloads = []
        for page in pages:
            payload = build_payload(settings, page, templates)
            if args.seed is not None:
                payload["parameters"]["seed"] = args.seed
            payloads.append(payload)
            nchar = len(payload["parameters"]["characterPrompts"])
            coords = payload["parameters"]["characterPrompts"]
            pos = " ".join(
                f"{i+1}:({c['center']['x']:.2f},{c['center']['y']:.2f})"
                for i, c in enumerate(coords)
            )
            print(
                f"- ページ{page['number']}: Character {nchar} / "
                f"Base {len(page['base'])}字 / 位置 {page['pin_source']} {pos}"
            )
        dump = ROOT / "work" / "generated" / f"{md_path.stem}-dry-run.json"
        dump.parent.mkdir(parents=True, exist_ok=True)
        dump.write_text(
            json.dumps(payloads, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"ドライランJSON: {dump}")
        print("トークンは使いません。このあと .env を置いて --page 1 から実生成します。")
        return 0

    token = load_token()
    jobs: list[tuple[dict, str, int]] = []
    for page in pages:
        for take in range(1, args.count + 1):
            stem = (
                f"page-{page['number']:02d}"
                if args.count == 1
                else f"page-{page['number']:02d}-{take}"
            )
            jobs.append((page, stem, take))
    remaining = list(jobs)
    for i, (page, stem, take) in enumerate(jobs):
        dest = out_dir / f"{stem}.png"
        if args.skip_existing and dest.is_file():
            print(f"スキップ ページ{page['number']} ({take}/{args.count}) 既存 {dest.name}")
            remaining = [job for job in remaining if job != (page, stem, take)]
            continue
        payload = build_payload(settings, page, templates)
        if args.seed is not None:
            payload["parameters"]["seed"] = args.seed + (take - 1)
        label = f"ページ{page['number']}"
        if args.count > 1:
            label += f" ({take}/{args.count})"
        print(f"生成中 {label}（位置 {page['pin_source']}）…")
        blob = request_image(token, payload, args.timeout)
        files = save_zip_pngs(blob, out_dir, stem)
        for path in files:
            print(f"  保存: {path}")
        remaining = [job for job in remaining if job != (page, stem, take)]
        if remaining and args.sleep > 0:
            time.sleep(args.sleep)
    print(f"完了: {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
