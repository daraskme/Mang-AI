#!/usr/bin/env python3
"""AIクリシェクラスタの検査。

英語圏フィクション由来の直訳クリシェ・感情ぼかし・定型構文など、単語単位では
自然だが密度と反復でAI臭を生む表現を、クラスタ（同機能の表現群）単位で数え、
話単位の上限・近接密集・場面末尾の3軸で[警告]として報告する。
正本: guidelines/05-ai-guardrails.md §3-4（採否）・§3-5（圧縮癖5系統）。
改稿は humanize-ai-writing、診断の文脈判断は ai-novel-detector が受け持つ。

警告は候補であり、件数は合格条件ではない。機能して残す反復は
work/continuity/cliche-allowlist.txt へ、その回の機能を書いて再警告を避ける。
警告を消すためだけの登録はしない。
書式（タブ区切り、# 始まりは注釈）: クラスタID<TAB>ファイル名またはALL<TAB>理由

使い方:
  python3 scripts/cliche_check.py work/drafts/episode012.txt
  python3 scripts/cliche_check.py --all
  python3 scripts/cliche_check.py --strict --all   # 警告が残れば exit 1
  python3 scripts/cliche_check.py --stats --all    # 較正用の集計のみ
  python3 scripts/cliche_check.py --selftest       # パターン回帰テスト

終了コード: 0=警告なし（または--strictなし） / 1=--strictで警告あり / 2=検査不能
"""

from __future__ import annotations

import argparse
import re
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DRAFTS = ROOT / "work" / "drafts"
DEFAULT_ALLOWLIST = ROOT / "work" / "continuity" / "cliche-allowlist.txt"

SCENE_SPLIT = re.compile(r"^※[ 　]*※[ 　]*※[ 　]*$", re.M)
SENTENCE_SPLIT = re.compile(r"(?<=[。！？])")
DIALOGUE = re.compile(r"「[^」]*」")

# クラスタ定義: (ID, 名称, パターン, 話単位上限, 地の文限定, 場面末尾で監視)
# 上限は既存本文の実測で較正するラチェット方式。根拠は 05-ai-guardrails §3-4。
CLUSTERS: list[tuple[str, str, str, int, bool, bool]] = [
    ("B1", "胸の奥＋何か／灯",
     r"(?:胸|心)の(?:奥|内側?|中)(?:[^。！？\n]{0,25}?(?:何か|なにか|もの)[^。！？\n]{0,20}?(?:ざわめ|疼|うず|ほどけ|揺れ|震え|動|燻|くすぶ|締め)|[^。！？\n]{0,15}?(?:灯|火)が(?:とも|点|灯))",
     1, False, False),
    ("B1b", "胸の奥（単体頻度）", r"(?:胸|心)の奥", 3, False, False),
    ("B2", "呼吸クリシェ",
     r"(?:止めて|詰めて)いた(?:ことにも?気づかなかった)?息|(?:息|呼吸)の仕方を忘れ|肺から空気が抜け|息が喉に(?:引っ|ひっ)かか",
     1, False, False),
    ("B3", "心臓・鼓動",
     r"心臓が(?:跳ね|飛び跳ね|早鐘|うるさ|一拍)|鼓動が(?:速|早|耳の奥)", 2, False, False),
    ("B4", "涙・熱いもの",
     r"涙が(?:頬を伝|零れ|こぼれ|溢れ|あふれ)|一筋の涙|熱いものが(?:こみ|込み)上げ|鼻の奥がつんと",
     2, False, False),
    ("B5", "拳・爪・指先",
     r"拳を(?:強く)?握り(?:しめ|締め)|爪が(?:手のひら|掌|てのひら)に食い込|指先が(?:白く|震え)",
     2, False, False),
    ("B6", "衝撃の大仰化",
     r"世界から音が消え|時間が止まった(?:かの)?よう|頭が真っ白に|周囲(?:の音)?が遠のい|血の気が引",
     2, False, False),
    ("A1", "目・表情・所作ビート",
     r"(?:目|瞳|眉|視線|口角|口の端|唇|肩|顎)[をがのに]?[^。！？\n]{0,16}?(?:細め|見開|見張|ひそめ|寄せ|逸ら|そら|落と|伏せ|上げ|上が|持ち上が|すくめ|噛|かん|かみ|震え|強張|こわば|引き結)",
     6, False, False),
    ("A2", "身体部位の役割化（〜でない口／〜のような目）",
     r"(?:でない|ではない|のような|みたいな|側の)(?:口|目|耳|手|指|足|顔|背|胸|肩|喉|鼻|腹|掌|首|腕|瞳|眉)[でに](?![すいをがはもとのな])",
     0, False, False),
    ("A3", "身体部位の代理主語",
     r"(?<![頭役面帳])(?:手|目|口|声|足|耳|指|鼻)が[^。！？\n]{0,10}?(?:言っ|言う|答え|告げ|訊|尋ね|喋|語っ|数え|決め|選ん|知ら|思っ|迷っ)",
     0, True, False),
    ("A4", "無生物の発話・表情",
     r"(?:(?:家具|卓|机|椅子|壁|空気|沈黙|静けさ|部屋|町|店|灯り|霧|季節|ざわつき)[はがも]|(?:卓|部屋|町|店)の空気[はがも]|物のひとつひとつ[はがも])[^。！？\n]{0,10}?(?:喋|語っ|語る|笑っ|笑う|囁|告げ)|(?:部屋|空気|霧|ざわつき|静けさ|沈黙|町|季節|層|才)[のは][^。！？\n]{0,8}?顔を",
     0, True, False),
    # A5は役割名詞を列挙せず、パターンクラスで拾う。
    # 「漢語2〜4字＋の＋顔/声/口調」が役割・状態の貼り付けの典型形。慣用の連体修飾
    # （いつもの／泣き笑いの／真ん中の／怖がりの／当たり前の等）は和語でかなを含むため、
    # 漢字だけの修飾語に限定することで自動的に除外される。先頭の否定後読みで語の
    # 途中からの部分一致（人心地→心地）を防ぐ。
    ("A5", "役割・状態を顔・声・口調に貼る",
     r"(?<![一-龥])(?!人心地|親父|親爺|兄弟子|師匠)[一-龥]{2,4}の(?:顔|声|口調|目つき)"
     r"(?:で|だった|のまま|になっ|に似|を(?:やめ|置い|捨て|し(?:て|た)))"
     r"|(?:商い|見習い)の(?:顔|声)(?:で|だった|のまま|を(?:やめ|置い|捨て|し(?:て|た)))"
     r"|[^。！？\n、]{1,6}側の顔",
     0, False, False),
    ("A6", "心理の物品管理化（棚・札・鎧）",
     r"(?:保留|欠陥)の棚|棚の札を[^。！？\n]{0,12}?倒|棚に[^。！？\n]{0,8}?札が(?:一枚)?増え|(?:皮肉|理屈|強がり)の(?:鎧|皮)|鎧を着直|(?:商い|値付け)の背骨",
     0, True, False),
    ("A7", "無生物の行為主体化（噂が走る・地図が育つ）",
     r"噂(?:のほう|と[^。！？\n]{1,6})?[はがも][^。！？\n]{0,12}?(?:走|歩[きくい]|営業|着い|泳)|噂[はがも][^。！？\n]{0,10}?(?:谷|街道|山|国境|海|町)を越え|(?:話|名)[はがも][^。！？\n]{0,10}?(?:走り出|歩き出)|(?:地図|看板)[はがも][^。！？\n]{0,10}?育|紙の上で育|町が送り出(?!で)",
     0, False, False),
    ("E1", "「何か」ぼかし",
     r"(?:言葉に(?:でき|なら)ない|名前の(?:ない|つけられない)|まだ名前のない)(?:何か|感情|想い|気持ち)|何かが(?:内側|奥)で",
     1, False, False),
    ("E2", "感情の配合表",
     r"(?:安堵|喜び|期待|怒り|悲しみ|不安|恐れ|寂しさ|懐かしさ)と[^。！？\n]{0,15}?(?:入り混じ|ないまぜ|綯い交ぜ|混じり合)",
     1, False, False),
    ("E3", "ヘッジ副詞（合算）",
     r"わずかに|かすかに|微かに|小さく(?:笑|頷|うなず|息|首)|そっと|ゆっくりと|どこか(?:懐かし|寂し|嬉し|悲し|遠)|なぜか|ふと、",
     10, False, False),
    ("E4", "静か系の決め",
     r"静かな(?:怒り|決意|覚悟|自信|確信|反逆|闘志|狂気|熱)|静かに、(?:しかし|だが)",
     2, False, True),
    ("E5", "抽象概念の物性化",
     r"(?:言葉|声|沈黙|感情|記憶|関係|視線)の(?:温度|重さ|重み|輪郭|質感|手触り)|沈黙が(?:落ち|横たわ|流れ|降り)|解像度が(?:上が|高)",
     2, False, False),
    ("R1", "一拍・間の定型",
     r"一拍(?:置いて|おいて|の間|、)|一呼吸(?:置いて|おいて)|しばしの沈黙", 3, False, False),
    ("R2", "否定対句（地の文）",
     r"(?:ではない|じゃない)。[^。！？\n]{1,40}(?:だ|だった|なのだ)(?:。|$)", 2, True, False),
    ("R3", "場面締め定型",
     r"それだけで(?:十分|充分)だった|ただ、?それだけの?(?:こと)?だった|それが答えだった|の証だった|これでいい。|それでいい。",
     2, False, True),
    ("R4", "という名の", r"という名の", 1, False, False),
    ("V1", "固定比喩道具",
     r"羅針盤|タペストリー|運命の(?:糸|歯車)|歯車が(?:回|噛み合)|パズルのピース|ガラス細工|織りなす|架け橋|一筋の光",
     2, False, False),
    ("V2", "美文動詞（紡ぐ・彩る）",
     r"(?:言葉|想い|思い|物語|音|時間|日々)を紡|を彩(?:る|っ)|に染め(?:上げ|られ)", 2, False, False),
    ("D4", "付加疑問の直訳",
     r"(?:だろう|でしょう)？」|そうだろう？|じゃないか？」|そう思わないか", 4, False, False),
    ("S2", "教訓・テーマ明示",
     r"人は[^。！？\n]{0,25}(?:ものだ|ものなのだ)|(?:本当の|真の)(?:強さ|優しさ|愛|意味)(?:の意味)?を(?:知っ|理解し)|新(?:しい|たな)始まり",
     1, False, True),
]

WINDOW_SIZE = 800
WINDOW_STEP = 400
WINDOW_MIN_CLUSTERS = 3   # 800字窓に異なるクラスタが何種で密集警告か
WINDOW_MIN_HITS = 5       # かつ合計ヒット数
WINDOW_FAMILIES = {"B", "A", "E"}  # 密集監視の対象系統（構文・語彙系は除く）

SELFTEST = {
    "B1": (["胸の奥で何かがざわめいた", "心の中で、なにかがほどけた気がした",
            "胸の奥に小さな灯がともった"],
           ["胸のポケットに手を入れた", "山の奥で何かが光った"]),
    "B2": (["止めていた息をようやく吐き出した", "呼吸の仕方を忘れた", "息が喉にひっかかった"],
           ["息を整えて走り出した", "深い息を吐いた"]),
    "B3": (["心臓が跳ねた", "心臓が早鐘を打つ", "鼓動が耳の奥で鳴っていた"],
           ["心臓の病を患っていた"]),
    "B4": (["涙が頬を伝った", "熱いものがこみ上げた", "一筋の涙が流れた"],
           ["涙をぬぐって立ち上がった"]),
    "B5": (["拳を握りしめた", "爪が手のひらに食い込んだ", "指先が震えていた"], []),
    "B6": (["世界から音が消えた", "頭が真っ白になった", "時間が止まったかのようだった"], []),
    "A1": (["目を細めた", "眉をわずかにひそめた", "口の端がわずかに持ち上がった",
            "肩をすくめた", "唇を噛んだ"],
           ["目を閉じて眠った", "肩に手を置いた"]),
    "A2": (["商人でない口で答えた", "庭師のような目で見る", "案内する側の顔で先を行く",
            "壊れ物を扱う夜のような手に力を込めた"],
           ["自分の目で確かめる", "仕事の顔で言う", "人の倍の耳で聞き分ける",
            "できない口ぶりだった", "のような目をしていた"]),
    "A3": (["青い目が、目を逸らしながら言った", "ハルの耳が数を八と数え",
            "丸薬は飲みました、と小さな声が言う", "うちの鼻がそう言うなら"],
           ["目が覚めると隣は空だった", "祈りの声が聞こえた", "婆の目が笑っていた",
            "まだ手が覚えている", "頭目が背中へ言った"]),
    "A4": (["新入りの言い方に、卓が笑った", "三層は、別の顔をしていた",
            "物のひとつひとつが、住人の名を語る家だった", "部屋は物置の顔をやめた"],
           ["卓の全員が笑った", "家の中は、静かだった",
            "卓は、笑いと歓声でしばらく使いものにならなかった"]),
    "A5": (["仕事の顔で言う", "案内役の顔で先を行く", "受付嬢の顔を置いてきた",
            "商いの顔をしていなかった", "前歯まで見せる、開戦の顔だった",
            "五人とも、聞く側の顔ではなかった", "根拠を並べる前に結論から撃つ、射手の声だった",
            "セラが帳場から、完璧な商いの声で応じた",
            "全員が、少しずつ倹約の顔になっていく", "事実を並べるだけの、斥候の声だった",
            "上客の口調のまま、席へ向かった", "祈り手というより、射手の顔に似ていた"],
           ["真剣な顔で言い", "妙な顔でこちらを見上げていた", "泣き笑いの顔で",
            "商人の顔を長年さんざん見てきた", "声で分かった", "大きな声で言った",
            "ようやく人心地の声で言った", "警戒した猫の顔になった",
            "それからいつもの顔で笑った", "ちょうど真ん中の顔だった",
            "帳場に立つときの口調で答えた", "十歩手前くらいの顔で、じっと奥を見ていた",
            "親父の声のまま、ずっと残ってただけだ", "兄弟子の顔で笑った",
            "振り向いたハルは、怖がりの顔のままだった",
            "誰もが当たり前の顔でしていた"]),
    "A6": (["分からないところは、いつもどおり保留の棚だ",
            "保留の棚に、新しい札が一枚増えた", "棚の札を、カイは一枚、指で倒した",
            "髪と皮肉の鎧を着直した", "理屈の皮が薄い",
            "値付けは商いの背骨で、ここを外すと店は一月で傾く"],
           ["薬種棚の奥から瓶を取り出した", "査定札を受け取った", "鎧を着た騎士が通る",
            "棚に見本を並べた"]),
    "A7": (["噂は、今日も元気に営業中だ", "夕方のギルドは、噂のほうが先に着いていた",
            "地図は今日も、紙の上で育っていく", "話は勝手に走り出した",
            "その名が、王都へ向かって歩き出した日だった", "噂は国境を越え",
            "噂と実績は、王都圏でも並んで歩いているらしい"],
           ["噂を聞いた", "その噂は本当だった", "麦が育つ季節になった",
            "地図はまだ半分白かった", "彼の名が呼ばれた",
            "噂は、もう訂正の域を越えていた", "町が総出で送り出している"]),
    "E1": (["言葉にできない何かが広がった", "まだ名前のない感情だった", "何かが内側で動いた"], []),
    "E2": (["安堵と、少しの寂しさが入り混じった", "期待と恐れがないまぜになった"], []),
    "E3": (["わずかに口角を上げた", "小さく頷いた", "そっと手を重ねた",
            "どこか寂しげだった", "ふと、そう思った"],
           ["小さくなったセーター", "どこかへ行こう"]),
    "E4": (["静かな怒りが宿っていた", "静かに、しかし確かに"], []),
    "E5": (["声の温度が変わった", "沈黙が落ちた", "感情の輪郭がはっきりする"],
           ["部屋の温度を上げた", "荷物の重さを量った"]),
    "R1": (["一拍おいて、彼は答えた", "一呼吸置いてから", "しばしの沈黙の後"], []),
    "R2": (["それは同情ではない。もっと身勝手な感情だった。", "怒りじゃない。ただの確認だ。"],
           ["それは嘘ではないかと疑った。"]),
    "R3": (["それだけで十分だった", "それが答えだった", "長年の努力の証だった"],
           ["証拠はそれだけだった"]),
    "R4": (["優しさという名の暴力"], []),
    "V1": (["人生の羅針盤", "運命の糸が絡み合う", "歯車が回り始めた"], []),
    "V2": (["言葉を紡いだ", "夕陽が街を彩る", "茜色に染め上げられた空"], []),
    "D4": (["「分かっているだろう？」", "「そう思わないか、ユウキ」"], []),
    "S2": (["人は失って初めて気づくものだ", "本当の強さの意味を知った", "それは新たな始まりだった"], []),
}

JA_HEDGES = ("だろう", "でしょう", "かもしれ", "ではないか", "とは思う", "気がする", "はずだ")


def compiled_clusters() -> list[dict]:
    return [{"id": cid, "label": label, "re": re.compile(pat), "limit": limit,
             "narrative_only": narr, "scene_end": scene_end}
            for cid, label, pat, limit, narr, scene_end in CLUSTERS]


def load_allowlist(path: Path) -> set[tuple[str, str]]:
    entries: set[tuple[str, str]] = set()
    if not path.is_file():
        return entries
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        cols = line.split("\t")
        if len(cols) < 3:
            print(f"エラー: {path}:{lineno} 列が足りない（クラスタID/ファイル名またはALL/理由）",
                  file=sys.stderr)
            sys.exit(2)
        entries.add((cols[0].strip(), cols[1].strip()))
    return entries


def allowed(entries: set[tuple[str, str]], cid: str, filename: str) -> bool:
    return (cid, filename) in entries or (cid, "ALL") in entries


def sentences_of(text: str) -> list[str]:
    return [s.strip() for s in SENTENCE_SPLIT.split(text) if s.strip()]


def rhythm_info(text: str) -> str:
    """文長CV・同一文末連続・長断定連続の参考値（合否条件ではない）。"""
    sents = sentences_of(re.sub(r"\s+", "", text) and text)
    sents = [re.sub(r"\s+", "", s) for s in sents if re.sub(r"\s+", "", s)]
    if len(sents) < 5:
        return "リズム参考値: 文が少ないため省略"
    lengths = [len(s) for s in sents]
    mean = statistics.fmean(lengths)
    cv = statistics.pstdev(lengths) / mean if mean else 0.0
    endings = [s[-2:] for s in sents]
    best = cur = 1
    for a, b in zip(endings, endings[1:]):
        cur = cur + 1 if a == b else 1
        best = max(best, cur)
    run = cur = 0
    longest_assertive = 0
    for s, ln in zip(sents, lengths):
        assertive = ln >= 40 and "？" not in s and not any(h in s for h in JA_HEDGES)
        cur = cur + 1 if assertive else 0
        longest_assertive = max(longest_assertive, cur)
    return (f"リズム参考値: 文数{len(sents)} 文長CV {cv:.2f} "
            f"同一文末最長{best}連 長断定最長{longest_assertive}連")


def check_file(path: Path, clusters: list[dict], allow: set[tuple[str, str]],
               quiet: bool, stats: dict | None) -> int:
    text = path.read_text(encoding="utf-8")
    narrative = DIALOGUE.sub("", text)
    warnings = 0

    # 軸1: 話単位の上限
    hits_by_cluster: dict[str, list[int]] = {}
    for c in clusters:
        target = narrative if c["narrative_only"] else text
        positions = [m.start() for m in c["re"].finditer(target)]
        hits_by_cluster[c["id"]] = positions
        if stats is not None:
            stats.setdefault(c["id"], []).append(len(positions))
            continue
        if len(positions) > c["limit"] and not allowed(allow, c["id"], path.name):
            warnings += 1
            print(f"[警告] クリシェ: {c['id']} {c['label']} {len(positions)}回"
                  f"（上限{c['limit']}） {path.name}")

    if stats is not None:
        return 0

    # 軸2: 近接密集（B/A/E系のみ、位置は本文基準のため地の文限定クラスタは除外済み）
    dense_reported = False
    for start in range(0, max(1, len(text) - WINDOW_SIZE + 1), WINDOW_STEP):
        end = start + WINDOW_SIZE
        in_window = {cid: sum(1 for p in ps if start <= p < end)
                     for cid, ps in hits_by_cluster.items()
                     if cid[0] in WINDOW_FAMILIES}
        kinds = [cid for cid, n in in_window.items() if n > 0
                 and not allowed(allow, cid, path.name)]
        total = sum(in_window[cid] for cid in kinds)
        if len(kinds) >= WINDOW_MIN_CLUSTERS and total >= WINDOW_MIN_HITS and not dense_reported:
            warnings += 1
            dense_reported = True   # 話単位で1回だけ報告
            print(f"[警告] クリシェ密集: {start}字付近の{WINDOW_SIZE}字に"
                  f"{'/'.join(sorted(kinds))} 計{total}回 {path.name}")

    # 軸3: 場面末尾の決め癖
    for si, scene in enumerate(SCENE_SPLIT.split(text), 1):
        tail = "".join(sentences_of(scene)[-3:])
        if not tail:
            continue
        for c in clusters:
            if not c["scene_end"] or allowed(allow, c["id"], path.name):
                continue
            if c["re"].search(tail):
                warnings += 1
                print(f"[警告] 場面末尾: 場面{si}の末尾3文に {c['id']} {c['label']} {path.name}")

    if not quiet:
        print(f"  {path.name}: {rhythm_info(text)}")
    return warnings


def run_selftest(clusters: list[dict]) -> int:
    by_id = {c["id"]: c for c in clusters}
    failures = 0
    for cid, (positives, negatives) in SELFTEST.items():
        rx = by_id[cid]["re"]
        for s in positives:
            if not rx.search(s):
                print(f"[NG] selftest {cid}: マッチすべき文が外れた: {s}")
                failures += 1
        for s in negatives:
            if rx.search(s):
                print(f"[NG] selftest {cid}: 誤検出: {s}")
                failures += 1
    print("selftest: " + ("OK" if failures == 0 else f"{failures}件failed"))
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description="AIクリシェクラスタ（密度・密集・場面末尾）を検査する")
    parser.add_argument("targets", nargs="*", help="検査対象の本文ファイル")
    parser.add_argument("--all", action="store_true", help="drafts配下の全話を検査")
    parser.add_argument("--drafts-dir", type=Path, default=DEFAULT_DRAFTS)
    parser.add_argument("--allowlist", type=Path, default=DEFAULT_ALLOWLIST)
    parser.add_argument("--strict", action="store_true", help="警告が1件でもあれば exit 1")
    parser.add_argument("--quiet", "-q", action="store_true", help="警告のみ出力")
    parser.add_argument("--stats", action="store_true", help="較正用にクラスタ別の分布だけを出す")
    parser.add_argument("--selftest", action="store_true", help="パターンの回帰テスト")
    args = parser.parse_args()

    clusters = compiled_clusters()
    if args.selftest:
        return 1 if run_selftest(clusters) else 0

    if not args.targets and not args.all:
        parser.print_usage(sys.stderr)
        print("エラー: 対象ファイルを指定するか --all を使う", file=sys.stderr)
        return 2

    allow = load_allowlist(args.allowlist)
    targets = [Path(t) for t in args.targets] if args.targets else \
        sorted(args.drafts_dir.glob("*.txt"))
    missing = [p for p in targets if not p.is_file()]
    if missing:
        for p in missing:
            print(f"エラー: ファイルがない: {p}", file=sys.stderr)
        return 2

    stats: dict[str, list[int]] | None = {} if args.stats else None
    total_warnings = 0
    for p in targets:
        total_warnings += check_file(p, clusters, allow, args.quiet, stats)

    if stats is not None:
        by_id = {c["id"]: c for c in clusters}
        print(f"クラスタ別分布（{len(targets)}話）: ID 合計 最大/話 超過話数 現行上限")
        for cid, counts in stats.items():
            c = by_id[cid]
            over = sum(1 for n in counts if n > c["limit"])
            print(f"  {cid}\t{c['label']}\t計{sum(counts)}\t最大{max(counts)}\t"
                  f"超過{over}話\t上限{c['limit']}")
        return 0

    print(f"クリシェ検査: 警告 {total_warnings}件（クラスタ {len(clusters)}種、対象 {len(targets)}話）")
    if total_warnings:
        print("       対応: 05-ai-guardrails §3-4 で採否する。"
              f"残す反復は {args.allowlist} へ機能の理由を書いて再警告を避ける。"
              "意味を変える変奏や、警告を消すためだけの登録はしない")
    if args.strict and total_warnings:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
