#!/usr/bin/env bash
# novel-Standard 日本語Web小説本文検査スクリプト
#
# 使い方:
#   scripts/check.sh <本文ファイル> [<本文ファイル>...]
#   scripts/check.sh path/to/episode.txt
#   find drafts/ -name '*.txt' -print0 | xargs -0 scripts/check.sh
#
# オプション:
#   --quiet, -q     違反のみ出力（OK項目を抑止）
#   --strict        1件でも違反があれば exit 1
#   --no-color      色付けを無効化
#   --section <名>  指定セクションのみ実行。有効名: markdown interface spaces quotes
#                   leader dash kagi lang waku mojisuu cluster explain past
#                   kimezerifu leader_overuse ruby
#   --help, -h      このヘルプを表示
#
# 判定は2段階:
#   [NG]   違反。機械的に一意な規約違反（記号・他言語・閉じカギ句点など）。
#          --strict 時に exit 1 の対象。必ず修正する。
#   [警告] 要確認。統計的指標（過去形連続・頻出語・英単語など）。exit code に
#          影響しない。文脈上正当なら本文を歪めてまで消さないこと。
#
# 各項目は guidelines/ 配下のどのルールに該当するか明示する。
# Pythonとgrep -P (PCRE) を併用してUnicode範囲・複合パターンを検出する。

CHECK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$CHECK_ROOT/tools/bin:$PATH"
unset CHECK_ROOT

set -u
set -o pipefail

# UTF-8 ロケール強制（非UTF-8ロケールでは grep -P の \x{...} がエラーになり、
# || true に握り潰されて全 Unicode 検査が無音で素通りするため）
if locale -a 2>/dev/null | grep -qiE '^C\.(UTF-8|utf8)$'; then
    export LC_ALL=C.UTF-8
elif locale -a 2>/dev/null | grep -qiE '^ja_JP\.(UTF-8|utf8)$'; then
    export LC_ALL=ja_JP.UTF-8
fi

# grep -P + UTF-8 の自己診断。PCRE 非対応の grep（macOS/BSD 標準）や UTF-8 が
# 使えない環境では検査不能として明示的に落とす（無音の全項目OKを出さない）
if ! printf 'あ' | grep -qP '[\x{3042}]' 2>/dev/null; then
    echo "エラー: この環境の grep では検査できません（GNU grep の -P + UTF-8 ロケールが必要）" >&2
    echo "macOS では GNU grep (ggrep) を導入し PATH の先頭に置いてください" >&2
    exit 2
fi

# ============================================================
# 設定
# ============================================================

QUIET=0
STRICT=0
USE_COLOR=1
SECTION=""
VALID_SECTIONS="markdown interface spaces quotes leader dash kagi lang waku mojisuu cluster explain past kimezerifu leader_overuse ruby"

# ターミナルでないなら色を無効化
if [ ! -t 1 ]; then
    USE_COLOR=0
fi

# ============================================================
# 引数解析
# ============================================================

FILES=()
while [ $# -gt 0 ]; do
    case "$1" in
        --quiet|-q) QUIET=1; shift ;;
        --strict) STRICT=1; shift ;;
        --no-color) USE_COLOR=0; shift ;;
        --section)
            if [ $# -lt 2 ]; then
                echo "エラー: --section に値がありません" >&2
                exit 2
            fi
            SECTION="$2"; shift 2
            case " $VALID_SECTIONS " in
                *" $SECTION "*) ;;
                *)
                    echo "エラー: 不明なセクション名: $SECTION" >&2
                    echo "有効名: $VALID_SECTIONS" >&2
                    exit 2
                    ;;
            esac
            ;;
        --help|-h)
            # ヘルプ＝ファイル冒頭のコメントブロック（shebang の次行から最初の空行まで）
            awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "$0"
            exit 0
            ;;
        --) shift; while [ $# -gt 0 ]; do FILES+=("$1"); shift; done ;;
        -*)
            echo "不明なオプション: $1" >&2
            echo "使い方は --help を参照" >&2
            exit 2
            ;;
        *) FILES+=("$1"); shift ;;
    esac
done

if [ ${#FILES[@]} -eq 0 ]; then
    echo "エラー: 本文ファイルを1つ以上指定してください" >&2
    echo "使い方: $0 <本文ファイル> [<本文ファイル>...]" >&2
    exit 2
fi

# ============================================================
# 色設定
# ============================================================

if [ "$USE_COLOR" -eq 1 ]; then
    RED=$'\033[31m'
    YELLOW=$'\033[33m'
    GREEN=$'\033[32m'
    CYAN=$'\033[36m'
    BOLD=$'\033[1m'
    DIM=$'\033[2m'
    RESET=$'\033[0m'
else
    RED=""
    YELLOW=""
    GREEN=""
    CYAN=""
    BOLD=""
    DIM=""
    RESET=""
fi

# ============================================================
# 集計用カウンタ（ファイル単位でリセット）
# ============================================================

VIOLATIONS_TOTAL=0
WARNINGS_TOTAL=0
FILE_VIOLATIONS=0
FILE_WARNINGS=0
FILE_ERRORS=0

# ============================================================
# 出力ヘルパ
# ============================================================

# 違反を1件出力する
# 引数: $1=セクション名 $2=ガイド参照 $3=説明 $4=該当行（複数行可）
report_violation() {
    local label="$1"
    local guide="$2"
    local desc="$3"
    local hits="$4"

    if [ -z "$hits" ]; then
        return
    fi

    local count
    count=$(printf '%s\n' "$hits" | grep -c '.' || true)
    FILE_VIOLATIONS=$((FILE_VIOLATIONS + count))

    printf '%s%s[NG]%s %s%s%s %s(%s)%s\n' \
        "$BOLD" "$RED" "$RESET" "$BOLD" "$label" "$RESET" \
        "$DIM" "$guide" "$RESET"
    if [ -n "$desc" ]; then
        printf '     %s\n' "$desc"
    fi
    printf '%s\n' "$hits" | head -n 20 | sed 's/^/     /'
    if [ "$count" -gt 20 ]; then
        printf '     %s... (他%d件)%s\n' "$DIM" "$((count - 20))" "$RESET"
    fi
    printf '\n'
}

# 警告（要確認・統計指標）を1件出力する。--strict の exit code に影響しない
# 引数: $1=セクション名 $2=ガイド参照 $3=説明 $4=該当行（複数行可）
report_warning() {
    local label="$1"
    local guide="$2"
    local desc="$3"
    local hits="$4"

    if [ -z "$hits" ]; then
        return
    fi

    local count
    count=$(printf '%s\n' "$hits" | grep -c '.' || true)
    FILE_WARNINGS=$((FILE_WARNINGS + count))

    printf '%s%s[警告]%s %s%s%s %s(%s)%s\n' \
        "$BOLD" "$YELLOW" "$RESET" "$BOLD" "$label" "$RESET" \
        "$DIM" "$guide" "$RESET"
    if [ -n "$desc" ]; then
        printf '     %s\n' "$desc"
    fi
    printf '%s\n' "$hits" | head -n 20 | sed 's/^/     /'
    if [ "$count" -gt 20 ]; then
        printf '     %s... (他%d件)%s\n' "$DIM" "$((count - 20))" "$RESET"
    fi
    printf '\n'
}

report_ok() {
    if [ "$QUIET" -eq 1 ]; then
        return
    fi
    local label="$1"
    printf '%s%s[OK]%s %s\n' "$BOLD" "$GREEN" "$RESET" "$label"
}

section_header() {
    if [ "$QUIET" -eq 1 ]; then
        return
    fi
    printf '\n%s%s── %s ──%s\n' "$BOLD" "$CYAN" "$1" "$RESET"
}

# セクションを実行するか判定
should_run() {
    [ -z "$SECTION" ] || [ "$SECTION" = "$1" ]
}

# ============================================================
# 検出ルーチン本体
# ============================================================

check_file() {
    local file="$1"
    FILE_VIOLATIONS=0
    FILE_WARNINGS=0

    if [ ! -f "$file" ]; then
        printf '%s[ERR]%s ファイルが見つからない: %s\n' "$RED" "$RESET" "$file" >&2
        return 1
    fi

    if [ ! -r "$file" ]; then
        printf '%s[ERR]%s 読み取り不能: %s\n' "$RED" "$RESET" "$file" >&2
        return 1
    fi

    printf '\n%s═══ %s ═══%s\n' "$BOLD" "$file" "$RESET"

    # ----------------------------------------
    # 1. マークダウン痕跡（観点1）→ 01-writing-rules.md §1〜2
    # ----------------------------------------
    if should_run markdown; then
        section_header "1. マークダウン痕跡"

        # 先頭BOM（行頭アンカー ^ の検査を先頭行で無効化するため必ず除去する）
        local hits
        if [ "$(head -c 3 "$file")" = $'\xef\xbb\xbf' ]; then
            report_violation "先頭BOM（UTF-8 BOM）" "01-writing-rules §9" \
                "BOMを除去する（sed -i '1s/^\\xef\\xbb\\xbf//' で削除可）" "1:（ファイル先頭にBOM）"
        else
            report_ok "BOMなし"
        fi

        # 強調 ** *
        hits=$(grep -nE '\*\*[^*]+\*\*|(^|[^*])\*[^* ][^*]*\*([^*]|$)' "$file" || true)
        if [ -n "$hits" ]; then
            report_violation "マークダウン強調 (** または *)" "01-writing-rules §1〜2" \
                "削除する。強調は『〜』または傍点 《《対象》》" "$hits"
        else
            report_ok "マークダウン強調なし"
        fi

        # 見出し # ## ###
        hits=$(grep -nE '^#{1,6} ' "$file" || true)
        if [ -n "$hits" ]; then
            report_violation "マークダウン見出し (# ## ###)" "01-writing-rules §1〜2" \
                "章タイトルは投稿サイトの章入力欄に分離する" "$hits"
        else
            report_ok "マークダウン見出しなし"
        fi

        # 水平線 --- ***
        hits=$(grep -nE '^(---+|\*\*\*+)$' "$file" || true)
        if [ -n "$hits" ]; then
            report_violation "水平線 (--- ***)" "01-writing-rules §1〜2" \
                "場面区切りは ※　※　※ などに置換" "$hits"
        else
            report_ok "水平線なし"
        fi

        # コードブロック ```
        hits=$(grep -nE '^```' "$file" || true)
        if [ -n "$hits" ]; then
            report_violation "コードブロック (\`\`\`)" "01-writing-rules §1〜2" \
                "完全削除" "$hits"
        else
            report_ok "コードブロックなし"
        fi

        # 箇条書き * - 1.
        hits=$(grep -nE '^[[:space:]]*([*-]|[0-9]+\.) ' "$file" || true)
        if [ -n "$hits" ]; then
            report_violation "箇条書きマーカー (* - 1.)" "01-writing-rules §1〜2" \
                "散文に書き直す" "$hits"
        else
            report_ok "箇条書きなし"
        fi
    fi

    # ----------------------------------------
    # 2. AIインターフェース痕跡（観点5）→ 05-ai-guardrails §6
    # ----------------------------------------
    if should_run interface; then
        section_header "2. AIインターフェース痕跡"

        # 確定的なAIインターフェース痕跡（本文で正当になる余地がない）
        local hits
        hits=$(grep -nE '以下、続きを|続きを書きます|続きを書かせて|ご要望があれば|お知らせください|進めていいですか|編集長、こんな感じで' "$file" || true)
        if [ -n "$hits" ]; then
            report_violation "AI返答プレフィックス・サフィックス" "05-ai-guardrails §6" \
                "完全削除" "$hits"
        else
            report_ok "AI返答プレフィックスなし"
        fi

        # 台詞内では正当になりうる語（地の文冒頭のAI返答なら削除、台詞なら残してよい）
        hits=$(grep -nE '分かりました|わかりました|承知しました|了解しました|いかがでしょうか' "$file" || true)
        if [ -n "$hits" ]; then
            report_warning "AI返答に典型的な語（要文脈確認）" "05-ai-guardrails §6" \
                "キャラの台詞なら正当。地の文・冒頭のAI返答なら削除" "$hits"
        else
            report_ok "AI返答典型語なし"
        fi
    fi

    # ----------------------------------------
    # 3. 半角スペース混入（観点22）→ 01-writing-rules §5
    # ----------------------------------------
    if should_run spaces; then
        section_header "3. 半角スペース混入"

        local hits
        # 日本語文字（ひらがな・カタカナ・漢字）に挟まれた半角スペース（連続スペースも検出）
        hits=$(grep -nP '[\x{3041}-\x{309F}\x{30A1}-\x{30FF}\x{4E00}-\x{9FFF}\x{3400}-\x{4DBF}] +[\x{3041}-\x{309F}\x{30A1}-\x{30FF}\x{4E00}-\x{9FFF}\x{3400}-\x{4DBF}]' "$file" || true)
        if [ -n "$hits" ]; then
            report_violation "日本語間の半角スペース" "01-writing-rules §5" \
                "削除または読点「、」化" "$hits"
        else
            report_ok "日本語間の半角スペースなし"
        fi
    fi

    # ----------------------------------------
    # 4. ダブルクォート（観点22）→ 01-writing-rules §4
    # ----------------------------------------
    if should_run quotes; then
        section_header "4. ダブルクォート"

        local hits
        hits=$(grep -nE '"[^"]+"' "$file" || true)
        if [ -n "$hits" ]; then
            report_violation "ダブルクォート \"〜\"" "01-writing-rules §4" \
                "強調は『〜』に置換" "$hits"
        else
            report_ok "ダブルクォートなし"
        fi

        # スマートクォート（AIが多用する全角引用符）
        hits=$(grep -nP '[\x{201C}\x{201D}\x{2018}\x{2019}]' "$file" || true)
        if [ -n "$hits" ]; then
            report_violation "スマートクォート（\" \" ' '）" "01-writing-rules §4" \
                "「〜」または『〜』に置換" "$hits"
        else
            report_ok "スマートクォートなし"
        fi
    fi

    # ----------------------------------------
    # 5. 三点リーダ派閥揺れ（観点22）→ 01-writing-rules §1
    # ----------------------------------------
    if should_run leader; then
        section_header "5. 三点リーダ派閥揺れ"

        # 単独「…」（前後が「…」でない）
        local hits
        hits=$(grep -nP '(?<![…])…(?![…])' "$file" || true)
        if [ -n "$hits" ]; then
            report_violation "単独の三点リーダ「…」" "01-writing-rules §1" \
                "「……」（偶数個）に統一" "$hits"
        else
            report_ok "単独「…」なし"
        fi

        # 中黒・全角ピリオド・半角ピリオド・二点リーダ・中線リーダ代用
        hits=$(grep -nP '・・・|．．．|\.\.\.|[\x{2025}\x{22EF}]' "$file" || true)
        if [ -n "$hits" ]; then
            report_violation "三点リーダ代用 (・・・ ．．． ... ‥ ⋯)" "01-writing-rules §1" \
                "「……」に統一" "$hits"
        else
            report_ok "三点リーダ代用なし"
        fi

        # 奇数個の「…」連続（3, 5, 7...。単独1個は上の検査で報告済みのため二重計上しない）
        hits=$(grep -nP '(?<!…)…(……)+(?!…)' "$file" || true)
        if [ -n "$hits" ]; then
            report_violation "三点リーダの奇数個" "01-writing-rules §1" \
                "偶数個（基本2つ＝「……」）に揃える" "$hits"
        else
            report_ok "三点リーダ偶数個OK"
        fi
    fi

    # ----------------------------------------
    # 6. ダッシュ派閥揺れ（観点22）→ 01-writing-rules §2
    # ----------------------------------------
    if should_run dash; then
        section_header "6. ダッシュ派閥揺れ"

        # 長音記号で代用（かな直後でない「ーー」＝ダッシュ代用の可能性が高い）
        local hits
        hits=$(grep -nP '(?<![ぁ-んァ-ヶー])ーー' "$file" || true)
        if [ -n "$hits" ]; then
            report_violation "長音記号での代用 (ーー)" "01-writing-rules §2" \
                "「――」（U+2015 二倍ダーシ）に統一" "$hits"
        else
            report_ok "長音記号代用なし"
        fi

        # かな直後の「ーー」は伸ばし表現（きゃーー等）の可能性があるため警告に留める
        hits=$(grep -nP '(?<=[ぁ-んァ-ヶ])ーー' "$file" || true)
        if [ -n "$hits" ]; then
            report_warning "かな直後の「ーー」（要文脈確認）" "01-writing-rules §2" \
                "悲鳴・伸ばし表現なら正当。ダッシュの意図なら「――」に置換" "$hits"
        else
            report_ok "かな直後のーーなし"
        fi

        # 罫線・emダッシュ・enダッシュ・ハイフン類・マイナスでの代用（行全体が水平線のものは §1 で報告済みのため除外）
        hits=$(grep -nP '──|—|--|[\x{2010}\x{2012}\x{2013}\x{2212}]|(?<!─)─(?!─)' "$file" | grep -vE '^[0-9]+:[[:space:]]*-{3,}[[:space:]]*$' || true)
        if [ -n "$hits" ]; then
            report_violation "ダッシュ代用 (── — – ‐ − --)" "01-writing-rules §2" \
                "「――」に統一" "$hits"
        else
            report_ok "ダッシュ代用なし"
        fi

        # 正字（U+2015）の奇数個連続（1個・3個…）。偶数個「――」「――――」のみ許容
        hits=$(grep -nP '(?<!―)―(――)*(?!―)' "$file" || true)
        if [ -n "$hits" ]; then
            report_violation "二倍ダーシの奇数個" "01-writing-rules §2" \
                "偶数個（基本2つ＝「――」）に揃える" "$hits"
        else
            report_ok "二倍ダーシ偶数個OK"
        fi
    fi

    # ----------------------------------------
    # 7. 閉じカギ前の句点（観点22）→ 01-writing-rules §4
    # ----------------------------------------
    if should_run kagi; then
        section_header "7. 閉じカギ前の句点"

        local hits
        hits=$(grep -nE '。」|。』|、」|、』|！。|？。|！」。|？」。' "$file" || true)
        if [ -n "$hits" ]; then
            report_violation "閉じカギ前の句読点（。」 、」 ！。 ？。）" "01-writing-rules §4" \
                "句読点を取る。「行ってきます」が標準" "$hits"
        else
            report_ok "閉じカギ前の句読点なし"
        fi
    fi

    # ----------------------------------------
    # 8. 他言語混入（観点27）→ 01-writing-rules §9 【高優先度校正】
    # ----------------------------------------
    if should_run lang; then
        section_header "8. 他言語混入【高優先度校正】"

        # ハングル（音節・字母・互換字母 ㄱㅏ 等）
        local hits
        hits=$(grep -nP '[\x{AC00}-\x{D7A3}\x{1100}-\x{11FF}\x{3130}-\x{318F}\x{A960}-\x{A97F}]' "$file" || true)
        if [ -n "$hits" ]; then
            report_violation "ハングル混入" "01-writing-rules §9" \
                "意図しない混入なら日本語に置換" "$hits"
        else
            report_ok "ハングルなし"
        fi

        # ギリシャ文字（基本＋拡張）
        hits=$(grep -nP '[\x{0370}-\x{03FF}\x{1F00}-\x{1FFF}]' "$file" || true)
        if [ -n "$hits" ]; then
            report_violation "ギリシャ文字混入" "01-writing-rules §9" \
                "意図しない混入なら日本語に置換（例: ρό爵 → 男爵）" "$hits"
        else
            report_ok "ギリシャ文字なし"
        fi

        # キリル文字（基本＋補助）
        hits=$(grep -nP '[\x{0400}-\x{04FF}\x{0500}-\x{052F}]' "$file" || true)
        if [ -n "$hits" ]; then
            report_violation "キリル文字混入" "01-writing-rules §9" \
                "日本語に置換" "$hits"
        else
            report_ok "キリル文字なし"
        fi

        # アラビア・ヘブライ・タイ・デーヴァナーガリー文字
        hits=$(grep -nP '[\x{0590}-\x{05FF}\x{0600}-\x{06FF}\x{0750}-\x{077F}\x{0900}-\x{097F}\x{0E00}-\x{0E7F}]' "$file" || true)
        if [ -n "$hits" ]; then
            report_violation "アラビア・ヘブライ・タイ等の文字混入" "01-writing-rules §9" \
                "日本語に置換" "$hits"
        else
            report_ok "アラビア・ヘブライ・タイ等なし"
        fi

        # 半角英単語混入（3文字以上連続のラテン文字）。SSR・DNA等の正当な略語がありうるため警告
        hits=$(grep -nP '(?<![A-Za-z])[A-Za-z]{3,}(?![A-Za-z])' "$file" || true)
        if [ -n "$hits" ]; then
            report_warning "半角英単語混入（要確認）" "01-writing-rules §9" \
                "意図的な英単語・略語でなければ日本語または全角に置換" "$hits"
        else
            report_ok "半角英単語なし"
        fi

        # 全角英字の単語（ｅｌｅｇａｎｔ等のAIバグ。ＭＭＯ・ＳＳＲ等の意図的な全角略語は正当）
        hits=$(grep -nP '[\x{FF21}-\x{FF3A}\x{FF41}-\x{FF5A}]{3,}' "$file" || true)
        if [ -n "$hits" ]; then
            report_warning "全角英字の単語（要確認）" "01-writing-rules §9" \
                "ＭＭＯ等の意図的な全角略語なら正当。英単語の混入なら日本語に置換" "$hits"
        else
            report_ok "全角英字の単語なし"
        fi
    fi

    # ----------------------------------------
    # 9. 話数地の文混入（観点2）→ AGENTS.md 三大原則・執筆規則
    # ----------------------------------------
    if should_run waku; then
        section_header "9. 話数地の文混入"

        local hits
        hits=$(grep -nP '(?:[一二三四五六七八九十百]+|[0-9]+|[０-９]+)話[かでにのを目]' "$file" || true)
        if [ -n "$hits" ]; then
            report_violation "話数の地の文混入" "AGENTS.md 執筆規則" \
                "「3話から泣いていない」→「あの夜から泣いていない」など出来事ベースに" "$hits"
        else
            report_ok "話数地の文混入なし"
        fi
    fi

    # ----------------------------------------
    # 10. 文字数フレーズ（観点3）→ 02-narrative-craft §2-4
    # ----------------------------------------
    if should_run mojisuu; then
        section_header "10. 文字数フレーズ"

        local hits
        hits=$(grep -nP '(?:[一二三四五六七八九十]+|[0-9]+|[０-９]+)文字[にで]' "$file" || true)
        if [ -n "$hits" ]; then
            report_warning "「○文字」表現（要文字数確認）" "02-narrative-craft §2-4" \
                "「『ありがとう』その四文字に救われた」型は実数と整合させる（実5文字）。数えて合っていれば正当" "$hits"
        else
            report_ok "「○文字」表現なし"
        fi
    fi

    # ----------------------------------------
    # 11. 定型・反復候補（観点23）→ 05-ai-guardrails §3
    # ----------------------------------------
    if should_run cluster; then
        section_header "11. 定型・反復候補"

        # 抽象動詞「整える・削る・回す」
        local count_total=0
        local report=""
        local word counts
        for word in 整える 削る 回す 揃える; do
            # 行数でなく出現回数を数える（Web小説は段落＝1行で複数文が同一行に載るため）
            counts=$(grep -oE "$word" "$file" | wc -l || true)
            if [ "$counts" -ge 3 ]; then
                report+="     ${word}: ${counts}回\n"
                count_total=$((count_total + counts))
            fi
        done
        if [ "$count_total" -gt 0 ]; then
            FILE_WARNINGS=$((FILE_WARNINGS + 1))
            printf '%s%s[警告]%s %s%s%s %s(%s)%s\n' \
                "$BOLD" "$YELLOW" "$RESET" "$BOLD" "抽象動詞（整える/削る/回す/揃える）が3回以上" "$RESET" \
                "$DIM" "05-ai-guardrails §3-1" "$RESET"
            printf '     具体動詞に置換を検討（並べる/拭く/磨く/切る/落とす など）。場面上必然なら正当\n'
            printf '%b' "$report"
            printf '\n'
        else
            report_ok "抽象動詞の過剰使用なし"
        fi

        # 名詞クラスタ候補
        local cluster_count=0
        local cluster_report=""
        for word in 銀木犀 輪郭 帳簿 礼節 秩序 一拍; do
            counts=$(grep -oE "$word" "$file" | wc -l || true)
            if [ "$counts" -ge 1 ]; then
                cluster_report+="     ${word}: ${counts}回\n"
                cluster_count=$((cluster_count + 1))
            fi
        done
        if [ "$cluster_count" -ge 3 ]; then
            FILE_WARNINGS=$((FILE_WARNINGS + 1))
            printf '%s%s[警告]%s %s%s%s %s(%s)%s\n' \
                "$BOLD" "$YELLOW" "$RESET" "$BOLD" "抽象語・事務語・雰囲気語が3種以上クラスタ" "$RESET" \
                "$DIM" "05-ai-guardrails §3-2" "$RESET"
            printf '     経理・帳簿系の作品設定でなければ削減を検討。各語が文脈上必然なら正当\n'
            printf '%b' "$cluster_report"
            printf '\n'
        else
            report_ok "名詞クラスタ候補なし"
        fi

        # 定型化しやすいフレーズ。単独では自然な日本語なので警告に留める。
        local hits
        hits=$(grep -nE '数字は嘘をつかない|帳簿は嘘をつかない|それだけで十分だった|最高の光栄です|私の心はもう動かない|感情ではなく整理です|場を整えてきた|席を降り|役を降り|マニュアルで標準化済み' "$file" || true)
        if [ -n "$hits" ]; then
            report_warning "定型化しやすいフレーズ（要文脈確認）" "05-ai-guardrails §3-3" \
                "単独出現は違反ではない。近接反復、人物間の使い回し、具体性の代用になっている場合だけ見直す" "$hits"
        else
            report_ok "定型化候補なし"
        fi
    fi

    # ----------------------------------------
    # 12. 説明動詞・抽象表現の過剰（観点10）→ 02-narrative-craft §2-1
    # ----------------------------------------
    if should_run explain; then
        section_header "12. 説明動詞の過剰使用"

        local count
        count=$(grep -oE 'と思った|と感じた|と考えた' "$file" | wc -l || true)
        if [ "$count" -ge 6 ]; then
            FILE_WARNINGS=$((FILE_WARNINGS + 1))
            printf '%s%s[警告]%s %s%s%s %s(%s)%s\n' \
                "$BOLD" "$YELLOW" "$RESET" "$BOLD" "説明動詞「思った/感じた/考えた」が${count}回" "$RESET" \
                "$DIM" "02-narrative-craft §2-1" "$RESET"
            printf '     身体反応・行動・台詞で示す（喉の奥が熱くなった など）\n\n'
        else
            report_ok "説明動詞の使用は許容範囲（${count}回）"
        fi

        count=$(grep -oE 'のようだった|のように見えた|ような気がした' "$file" | wc -l || true)
        if [ "$count" -ge 4 ]; then
            FILE_WARNINGS=$((FILE_WARNINGS + 1))
            printf '%s%s[警告]%s %s%s%s %s(%s)%s\n' \
                "$BOLD" "$YELLOW" "$RESET" "$BOLD" "比喩逃げ「〜のようだった/見えた」が${count}回" "$RESET" \
                "$DIM" "02-narrative-craft §2-1" "$RESET"
            printf '     断定または具体描写に書き換え\n\n'
        else
            report_ok "比喩逃げの過剰なし（${count}回）"
        fi
    fi

    # ----------------------------------------
    # 13. 過去形連続（観点10）→ 02-narrative-craft §2-3
    # ----------------------------------------
    if should_run past; then
        section_header "13. 過去形連続"

        # Pythonで「〜た。」が5文以上連続する箇所を、文脈確認用の統計として検出
        local hits
        hits=$(python3 - "$file" <<'PYEOF' 2>/dev/null || true
import sys, re
path = sys.argv[1]
with open(path, encoding='utf-8') as f:
    text = f.read()
sentences = re.split(r'(?<=[。！？\n])', text)
buf = []
streak = 0
streak_start = 0
hits = []
char_pos = 0
line = 1
line_starts = [0]
for i, ch in enumerate(text):
    if ch == '\n':
        line_starts.append(i + 1)
def line_of(pos):
    import bisect
    return bisect.bisect_right(line_starts, pos)
pos = 0
streak_start_pos = 0
for s in sentences:
    s_strip = s.strip()
    if not s_strip:
        pos += len(s)
        continue
    if re.search(r'た[。！？]?\s*$', s_strip):
        if streak == 0:
            streak_start_pos = pos
        streak += 1
        if streak >= 5:
            ln = line_of(streak_start_pos)
            preview = s_strip[:30]
            hits.append(f"{ln}: 過去形{streak}文連続（〜「{preview}…」）")
    else:
        streak = 0
    pos += len(s)
# 重複排除（同じ起点から複数回入るのを抑止）
seen = set()
unique = []
for h in hits:
    key = h.split(':')[0]
    if key not in seen:
        seen.add(key)
        unique.append(h)
print('\n'.join(unique))
PYEOF
)
        if [ -n "$hits" ]; then
            report_warning "過去形「〜た。」が5文以上連続（要文脈確認）" "02-narrative-craft §2-3" \
                "過去形自体は正当。同じ長さ・主語・構文・焦点まで反復して平坦な場合だけ、結合や焦点変更を検討" "$hits"
        else
            report_ok "過去形連続なし"
        fi
    fi

    # ----------------------------------------
    # 14. 決め台詞反復（観点6）→ 02-narrative-craft §5
    # ----------------------------------------
    if should_run kimezerifu; then
        section_header "14. 決め台詞・短台詞の反復"

        local hits
        hits=$(python3 - "$file" <<'PYEOF' 2>/dev/null || true
import sys, re
from collections import Counter
path = sys.argv[1]
with open(path, encoding='utf-8') as f:
    text = f.read()
# カギ括弧内の台詞を抽出
quotes = re.findall(r'「([^」]{2,30})」', text)
# 3回以上出現するもの
counter = Counter(quotes)
results = []
for line, n in counter.most_common():
    if n >= 3:
        results.append(f"「{line}」: {n}回")
print('\n'.join(results[:10]))
PYEOF
)
        if [ -n "$hits" ]; then
            report_warning "同一台詞が3回以上出現" "02-narrative-craft §5" \
                "「はい」「うん」等の相槌なら正当。決め台詞は反復によって意味・関係・状況が変わるか確認する" "$hits"
        else
            report_ok "決め台詞反復なし"
        fi
    fi

    # ----------------------------------------
    # 15. 文末三点リーダ多用（観点22）→ 01-writing-rules §1
    # ----------------------------------------
    if should_run leader_overuse; then
        section_header "15. 三点リーダ多用（接着剤的用法）"

        local count
        count=$(grep -oE '……' "$file" | wc -l || true)
        local total_lines
        total_lines=$(grep -c '' "$file" || true)  # 末尾改行なしの最終行も数える
        if [ "$total_lines" -gt 0 ] && [ "$count" -gt 0 ]; then
            local ratio=$((count * 100 / total_lines))
            if [ "$ratio" -ge 30 ]; then
                FILE_WARNINGS=$((FILE_WARNINGS + 1))
                printf '%s%s[警告]%s %s%s%s %s(%s)%s\n' \
                    "$BOLD" "$YELLOW" "$RESET" "$BOLD" "三点リーダの密度が高い（${count}回 / ${total_lines}行 = ${ratio}%）" "$RESET" \
                    "$DIM" "01-writing-rules §1" "$RESET"
                printf '     文の接着剤として同じ機能を反復していないか確認（行数基準の統計値のため沈黙が多い場面では正当になりうる）\n\n'
            else
                report_ok "三点リーダ密度OK（${count}回 / ${total_lines}行）"
            fi
        else
            report_ok "三点リーダ密度OK"
        fi
    fi

    # ----------------------------------------
    # 16. ルビの縦線欠落（観点22）→ 01-writing-rules §8
    # ----------------------------------------
    if should_run ruby; then
        section_header "16. ルビ記法（親文字直前の | 欠落）"

        local hits
        # 漢字親文字 + 《かな》 で、親文字の開始が半角/全角縦線で始まっていないもの。
        # 先頭の否定先読みで「漢字でも縦線でもない位置から始まる漢字連 + 《かな》」だけを拾う。
        # 既に | が付いたルビ・傍点《《…》》は除外される。
        hits=$(grep -nP '(?<![\x{4E00}-\x{9FFF}々〆ヶヵ｜|])[\x{4E00}-\x{9FFF}々〆ヶヵ]+《[\x{3041}-\x{30FF}]+》' "$file" || true)
        if [ -n "$hits" ]; then
            report_violation "ルビ親文字の直前に縦線 | がない" "01-writing-rules §8" \
                "親文字の直前に半角縦線を置く（東雲《しののめ》→ |東雲《しののめ》）。傍点《《…》》は対象外" "$hits"
        else
            report_ok "ルビの縦線あり（または該当ルビなし）"
        fi
    fi

    # ----------------------------------------
    # ファイル単位サマリ
    # ----------------------------------------
    printf '\n%s── %s サマリ ──%s\n' "$BOLD" "$file" "$RESET"
    if [ "$FILE_VIOLATIONS" -eq 0 ] && [ "$FILE_WARNINGS" -eq 0 ]; then
        printf '%s%s✔ 違反なし%s\n' "$BOLD" "$GREEN" "$RESET"
    elif [ "$FILE_VIOLATIONS" -eq 0 ]; then
        printf '%s%s✔ 違反なし%s（%s警告 %d件・要文脈確認%s）\n' "$BOLD" "$GREEN" "$RESET" "$YELLOW" "$FILE_WARNINGS" "$RESET"
    else
        printf '%s%s✘ 違反 %d件%s（警告 %d件）\n' "$BOLD" "$RED" "$FILE_VIOLATIONS" "$RESET" "$FILE_WARNINGS"
    fi

    VIOLATIONS_TOTAL=$((VIOLATIONS_TOTAL + FILE_VIOLATIONS))
    WARNINGS_TOTAL=$((WARNINGS_TOTAL + FILE_WARNINGS))
    return 0
}

# ============================================================
# メイン
# ============================================================

printf '%snovel-Standard 検出スクリプト%s\n' "$BOLD" "$RESET"
printf '%s対象ファイル: %d件%s\n' "$DIM" "${#FILES[@]}" "$RESET"

for f in "${FILES[@]}"; do
    check_file "$f" || FILE_ERRORS=$((FILE_ERRORS + 1))
done

# ============================================================
# 全体サマリ
# ============================================================

printf '\n%s═══ 全体サマリ ═══%s\n' "$BOLD" "$RESET"
if [ "$FILE_ERRORS" -gt 0 ]; then
    printf '%s%s検査不能ファイル %d件（パス誤りの可能性）%s\n' "$BOLD" "$RED" "$FILE_ERRORS" "$RESET"
fi
if [ "$WARNINGS_TOTAL" -gt 0 ]; then
    printf '%s警告 合計 %d件（統計指標・要文脈確認。正当なら残してよい）%s\n' "$YELLOW" "$WARNINGS_TOTAL" "$RESET"
fi
if [ "$VIOLATIONS_TOTAL" -eq 0 ] && [ "$FILE_ERRORS" -eq 0 ]; then
    printf '%s%s全ファイルOK（違反なし）%s\n' "$BOLD" "$GREEN" "$RESET"
    exit 0
elif [ "$VIOLATIONS_TOTAL" -gt 0 ]; then
    printf '%s%s合計違反 %d件%s\n' "$BOLD" "$RED" "$VIOLATIONS_TOTAL" "$RESET"
    if [ "$STRICT" -eq 1 ]; then
        exit 1
    fi
fi
if [ "$FILE_ERRORS" -gt 0 ]; then
    exit 2
fi
exit 0
