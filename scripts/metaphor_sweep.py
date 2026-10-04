#!/usr/bin/env python3
"""比喩圧縮癖の候補生成スイープ（再現率優先・非ゲート）。

外部仕様書「AI小説_比喩圧縮癖検査Skill_構築仕様書」の§9候補生成辞書・
§10パターンを実装した第1走査。cliche_check.py（別軸の警告候補）と二層構造をなす。
本スクリプトの出力は【候補】であり警告ではない。一致だけを根拠に本文を修正しない。
採否は guidelines/05-ai-guardrails.md §3-4。意味の変化は必須ではない。
残す条件は §3-5 を先に見る。除外のリストは免罪符にしない。

裁定済みの残置は work/continuity/sweep-adjudicated.tsv へ理由つきで登録して抑止する。
人物別モチーフの全話横断 census は work/motif-dictionary.tsv を正本とし、
work/pov-plan.md §2 の視点割当と突き合わせて「所有者以外の視点話での使用」を示す。

使い方:
  python3 scripts/metaphor_sweep.py --all              # 全話スイープ＋モチーフcensus
  python3 scripts/metaphor_sweep.py work/drafts/episode012.txt
  python3 scripts/metaphor_sweep.py --all --census-only
  python3 scripts/metaphor_sweep.py --all --compare <旧draftsディレクトリ>  # 解消/残存/新規
  python3 scripts/metaphor_sweep.py --selftest

終了コード: 0=正常（候補の有無を問わない） / 2=検査不能
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DRAFTS = ROOT / "work" / "drafts"
ADJUDICATED = ROOT / "work" / "continuity" / "sweep-adjudicated.tsv"
MOTIF_DICT = ROOT / "work" / "motif-dictionary.tsv"
POV_PLAN = ROOT / "work" / "pov-plan.md"

# ---- 候補生成辞書（外部仕様書 §9。見落とし防止用であり、一致は判定ではない） ----
BODY = r"(?:顔|目|眼|口|声|手|掌|指|腕|肩|背中|足|脚|耳|鼻|鼻先|喉|胸|腹|腰|眉|唇|舌|頭|心臓|体|血|骨|肌|尾)"
ROLE = r"(?:商人|職人|鑑定士|射手|弓手|剣士|神官|手当て屋|斥候|案内役|師匠|師範|姐御|上客|店主|隊長|兵士|学者|受付嬢?|営業|仕事|戦|喧嘩|祈り|倹約|開戦|世間話|帳場|酌)"
PSYCH = r"(?:強がり|迷い|覚悟|警戒|遠慮|戸惑い|諦め|決意|皮肉|怒り|悲しみ|寂しさ|緊張|恐怖|安心|期待|本気|正直)"
ABSTRACT = r"(?:言葉|問い|答え|理屈|皮肉|噂|評判|名|迷い|感情|沈黙|空気|関係|約束|心配|記憶|反論|判断|覚悟|願い|商い|話|情報|笑い|看板|店|家|町|地図|紙|手紙|筆)"
ITEM = r"(?:棚|札|鎧|皮|背骨|骨組み|糸|帯|枷|弦|矢|矢筒|通貨|値札|前金|予算|在庫|勘定|帳尻|荷物|棘)"
V_JUDGE = r"(?:覚え|知[るっ]|信じ|迷[うっ]|判断|答え|先回り|拒[むん]|望[むん]|仕事を|語[るっ]|待[つっ]|値踏み|選[ぶん])"
V_PERSON = r"(?:歩[きくい]|走[るっり]|届[きくい]|育[つっ]|待[つっ]|眠[るっ]|起き|笑[うっ]|喋|語[るっ]|呼[ぶん]|営業|逃げ|運ば|連れて|寝返|化け|正直)"

PATTERNS: list[tuple[str, str]] = [
    ("P1 役割語＋部位", ROLE + r"の?" + BODY + r"(?![一-龥])"),
    ("P2 部位が判断動詞", BODY + r"[がは][^。！？\n]{0,8}?" + V_JUDGE),
    ("P3 抽象概念が擬人動詞", ABSTRACT + r"[がはも][^。！？\n]{0,8}?" + V_PERSON),
    ("P4 心理の物品化", r"(?:保留|未解決|" + PSYCH + r"|関係|約束)[のをが^。！？\n]{0,12}?" + ITEM),
    ("P5 部位＋心理・役割名詞", BODY + r"[^。！？\n]{0,8}?(?:" + PSYCH + r"|商人|職人|射手|神官|仕事|夜|朝|戦|喧嘩)の"),
    ("P6 役割・道具の直喩", r"(?:" + ROLE + r"|" + ITEM + r")の(?:ような|ように|みたいな|みたいに|それ)"),
]

# 候補から外す機械近似。外れた文も §3-5 の残す条件は文脈で見る。リストは免罪符ではない
EXCLUDE = re.compile(
    r"目が覚め|目が笑|手が覚え|体が覚え|腹が減|背中に[^。！？\n]{0,6}?(?:返|声)|声が飛|"
    r"(?:噂|話|手紙|名|文|便り)[はがもの][^。！？\n]{0,10}?届|いつもの顔|泣き笑いの顔|当たり前の顔|"
    r"怖がりの顔|真ん中の顔|親父の|親爺の|兄弟子の|人心地|という顔|遠い目|目を(?:丸く|閉じ|見開)|"
    r"顔を(?:上げ|出し|見)|足を(?:止め|運ん)|手を(?:伸ば|止め|振)|息を(?:呑|整え)|頭を(?:抱え|下げ|振)|"
    r"喧嘩腰|[一二三四五六七八九十]戦目|(?:本|杯|軒|回|番|日|年|枚|層|歩|匹|つ)目|"
    r"目の前|衆目|目で追|顔ぶれ|祈り手|語り手|使い手|担い手|聞き手|受け手|書き手|遣い手|"
    r"手入れ|手袋|手紙|手順|手前|手続き|手土産|手間|手元|手筈|手配"
)

SELFTEST = [
    # (文, 候補になるべきか)
    ("値切りの利かない商人の顔を長年見てきた", True),
    ("手当て屋の目は、そういうところも見る", True),
    ("保留の棚に、新しい札が一枚増えた", True),
    ("噂は、今日も元気に営業中だ", True),
    ("目は職人のそれだった", True),
    ("耳が先回りする", True),
    ("ミナは足を止めた", False),
    ("ミナは顔を上げた", False),
    ("彼女は不安だった", False),
    ("噂は王都まで届いた", False),
    ("それからいつもの顔で笑った", False),
    ("手が覚えたほうが早い", False),
    ("三戦目まで粘った子は久しぶりだね", False),
    ("手紙は、昼過ぎに届いた", False),
    ("数字を目で追いながら", False),
    ("酌の顔ぶれを一人ずつ確かめた", False),
    ("長く祈り手をやってきたが", False),
    ("手入れだけが職人の水準だった", False),
]


def load_adjudicated(path: Path) -> list[tuple[str, str]]:
    entries: list[tuple[str, str]] = []
    if not path.is_file():
        return entries
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        cols = line.split("\t")
        if len(cols) < 4:
            print(f"エラー: {path}:{lineno} 列が足りない（キー/ファイル名またはALL/裁定/理由）",
                  file=sys.stderr)
            sys.exit(2)
        entries.append((cols[0].strip(), cols[1].strip()))
    return entries


def adjudicated(entries: list[tuple[str, str]], line: str, filename: str) -> bool:
    return any(key in line and fn in ("ALL", filename) for key, fn in entries)


def load_pov_map(path: Path) -> dict[int, str]:
    """pov-plan §2 の割当表から 話数→視点キャラ集合（P#連結）を得る。"""
    povs: dict[int, set[str]] = {}
    if not path.is_file():
        return {}
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\|\s*ep(\d+)\s*\|\s*\d+\s*\|\s*(P\d)\s*\|", line)
        if m:
            povs.setdefault(int(m.group(1)), set()).add(m.group(2))
    return {ep: "/".join(sorted(s)) for ep, s in povs.items()}


def load_motifs(path: Path) -> list[dict]:
    motifs = []
    if not path.is_file():
        return motifs
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        cols = line.split("\t")
        if len(cols) < 4:
            print(f"エラー: {path}:{lineno} 列が足りない（人物/POV#/パターン/メモ）",
                  file=sys.stderr)
            sys.exit(2)
        motifs.append({"owner": cols[0].strip(), "pov": cols[1].strip(),
                       "re": re.compile(cols[2].strip()), "note": cols[3].strip()})
    return motifs


def sweep_file(path: Path, entries: list[tuple[str, str]]) -> list[tuple[str, int, str, str]]:
    """(パターン名, 行番号, 一致断片, 前後つき断片) を返す。"""
    out = []
    lines = path.read_text(encoding="utf-8").split("\n")
    for pname, pat in PATTERNS:
        rx = re.compile(pat)
        for i, ln in enumerate(lines, 1):
            for m in rx.finditer(ln):
                frag = ln[max(0, m.start() - 14):m.end() + 14]
                if EXCLUDE.search(frag) or adjudicated(entries, ln, path.name):
                    continue
                out.append((pname, i, m.group(0), frag))
    return out


def candidate_keys(path: Path, entries: list[tuple[str, str]]) -> set[tuple[str, str]]:
    """比較モード用: (パターン名, 一致文字列) の集合。行番号は版間で揺れるため使わない。"""
    return {(pname, core) for pname, _, core, _ in sweep_file(path, entries)}


def run_selftest() -> int:
    rxs = [re.compile(p) for _, p in PATTERNS]
    failures = 0
    for text, should in SELFTEST:
        hit = any(r.search(text) for r in rxs) and not EXCLUDE.search(text)
        if hit != should:
            print(f"[NG] selftest: {'候補になるべき' if should else '除外されるべき'}: {text}")
            failures += 1
    print("selftest: " + ("OK" if failures == 0 else f"{failures}件failed"))
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(
        description="比喩圧縮癖の候補生成スイープ（非ゲート。出力は候補であり警告ではない）")
    parser.add_argument("targets", nargs="*", help="対象の本文ファイル")
    parser.add_argument("--all", action="store_true", help="drafts配下の全話")
    parser.add_argument("--drafts-dir", type=Path, default=DEFAULT_DRAFTS)
    parser.add_argument("--compare", type=Path, metavar="OLD_DIR",
                        help="旧版draftsディレクトリと比較（解消/残存/新規）")
    parser.add_argument("--census-only", action="store_true", help="モチーフcensusだけを出す")
    parser.add_argument("--quiet", "-q", action="store_true", help="断片の列挙を省く")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()

    if args.selftest:
        return 1 if run_selftest() else 0

    if not args.targets and not args.all:
        parser.print_usage(sys.stderr)
        print("エラー: 対象ファイルを指定するか --all を使う", file=sys.stderr)
        return 2

    entries = load_adjudicated(ADJUDICATED)
    targets = [Path(t) for t in args.targets] if args.targets else \
        sorted(args.drafts_dir.glob("*.txt"))
    missing = [p for p in targets if not p.is_file()]
    if missing:
        for p in missing:
            print(f"エラー: ファイルがない: {p}", file=sys.stderr)
        return 2

    # ---- 比較モード ----
    if args.compare:
        if not args.compare.is_dir():
            print(f"エラー: 比較先がない: {args.compare}", file=sys.stderr)
            return 2
        resolved = surviving = new = 0
        for p in targets:
            old_p = args.compare / p.name
            new_keys = candidate_keys(p, entries)
            old_keys = candidate_keys(old_p, entries) if old_p.is_file() else set()
            resolved += len(old_keys - new_keys)
            surviving += len(old_keys & new_keys)
            new += len(new_keys - old_keys)
            for pname, core in sorted(new_keys - old_keys):
                print(f"  [新規] {p.name} {pname}: {core}")
        print(f"比較: 解消 {resolved} / 残存 {surviving} / 新規 {new}（対象 {len(targets)}話）")
        return 0

    # ---- スイープ ----
    total = 0
    by_pattern: Counter = Counter()
    if not args.census_only:
        for p in targets:
            hits = sweep_file(p, entries)
            total += len(hits)
            for pname, li, _core, frag in hits:
                by_pattern[pname] += 1
                if not args.quiet:
                    print(f"  {p.name} L{li} [{pname}] …{frag}…")
        print(f"\nスイープ候補: {total}件（対象 {len(targets)}話、裁定済み抑止 {len(entries)}entry）")
        for pname, n in by_pattern.most_common():
            print(f"  {pname}: {n}件")
        print("注意: 候補は警告ではない。採否は 05-ai-guardrails §3-4 の場面テストで決め、"
              "残置は sweep-adjudicated.tsv へ理由つきで登録する。")

    # ---- モチーフ census（全話横断） ----
    motifs = load_motifs(MOTIF_DICT)
    if motifs and (args.all or args.census_only):
        pov_map = load_pov_map(POV_PLAN)
        print("\nモチーフcensus（全話横断。数値は密度確認のトリガーであり合否ではない）:")
        for m in motifs:
            eps: Counter = Counter()
            for p in targets:
                mm = re.match(r"episode(\d+)", p.name)
                epno = int(mm.group(1)) if mm else 0
                n = len(m["re"].findall(p.read_text(encoding="utf-8")))
                if n:
                    eps[epno] = n
            if not eps:
                continue
            spread = " ".join(
                f"ep{e:03d}:{c}" + ("" if m["pov"] in ("—", "") or m["pov"] in pov_map.get(e, "")
                                    else "※") for e, c in sorted(eps.items()))
            print(f"  {m['owner']}（{sum(eps.values())}件/{len(eps)}話）: {spread}")
        print("  ※=モチーフ所有者以外の視点の話。人物間流用でないか目視する。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
