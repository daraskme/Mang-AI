#!/usr/bin/env bash
# 検査系の回帰テスト。
#
# guidelines/ や scripts/check.sh の検出ルールを変更したとき、検出漏れと誤検出が
# 入っていないかを固定データで確かめる。期待値は tests/expectations.tsv にある。
#
# 使い方:
#   bash scripts/eval.sh
#
# 終了コード: 0=全ケース一致 / 1=不一致あり / 2=検査不能
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FIXTURES="tests/fixtures"
EXPECTATIONS="tests/expectations.tsv"

if [ ! -f "$EXPECTATIONS" ]; then
    echo "検査不能: $EXPECTATIONS がない" >&2
    exit 2
fi
if ! echo "あ" | grep -P 'あ' >/dev/null 2>&1; then
    echo "検査不能: grep -P（PCRE）が使えない。GNU grepが必要" >&2
    exit 2
fi

passes=0
failures=0

report() {
    # $1=結果(ok/ng) $2=ケース名 $3=詳細
    if [ "$1" = "ok" ]; then
        printf 'PASS  %s\n' "$2"
        passes=$((passes + 1))
    else
        printf 'FAIL  %s\n      %s\n' "$2" "$3"
        failures=$((failures + 1))
    fi
}

count_label() {
    # $1=出力 $2=ラベル
    printf '%s\n' "$1" | grep -c "\[$2\]" || true
}

# ------------------------------------------------------------------
# 1. 本文検査（check.sh）
# ------------------------------------------------------------------
while IFS=$'\t' read -r fixture want_exit want_ng want_warn _; do
    case "$fixture" in
        ""|\#*) continue ;;
    esac
    target="$FIXTURES/$fixture"
    if [ ! -f "$target" ]; then
        report ng "check.sh: $fixture" "fixtureがない: $target"
        continue
    fi

    output="$(bash scripts/check.sh --strict "$target" 2>&1)"
    code=$?
    got_ng="$(count_label "$output" NG)"
    got_warn="$(count_label "$output" 警告)"

    if [ "$code" = "$want_exit" ] && [ "$got_ng" = "$want_ng" ] && [ "$got_warn" = "$want_warn" ]; then
        report ok "check.sh: $fixture (exit=$code NG=$got_ng 警告=$got_warn)"
    else
        report ng "check.sh: $fixture" \
            "期待 exit=$want_exit NG=$want_ng 警告=$want_warn / 実際 exit=$code NG=$got_ng 警告=$got_warn"
    fi
done < "$EXPECTATIONS"

# ------------------------------------------------------------------
# 2. 状態台帳の検査（state_check.py）
# ------------------------------------------------------------------
STATE_REPO="$FIXTURES/state-repo"
# fixtureが踏むケース：
#   NG   本文に対応する状態差分がない／状態差分に対応する08-timeline §3の行がない／
#        伏線の回収章が設置章より前／情報格差マトリクスにない事実IDの参照
#   警告 状態差分と日付の正本の作中日時が不一致／08-timeline §3の先行記入／
#        回収章を通過した未回収伏線／本文があるのにシーンカードがない（2話分）
STATE_WANT_NG=4
STATE_WANT_WARN=5

if [ -d "$STATE_REPO/work" ]; then
    output="$(python3 scripts/state_check.py --root "$STATE_REPO" --strict --quiet 2>&1)"
    code=$?
    got_ng="$(count_label "$output" NG)"
    got_warn="$(count_label "$output" 警告)"
    if [ "$code" = "1" ] && [ "$got_ng" = "$STATE_WANT_NG" ] && [ "$got_warn" = "$STATE_WANT_WARN" ]; then
        report ok "state_check.py: state-repo (exit=$code NG=$got_ng 警告=$got_warn)"
    else
        report ng "state_check.py: state-repo" \
            "期待 exit=1 NG=$STATE_WANT_NG 警告=$STATE_WANT_WARN / 実際 exit=$code NG=$got_ng 警告=$got_warn"
    fi

    output="$(python3 scripts/state_check.py --root "$ROOT" --strict --quiet 2>&1)"
    code=$?
    if [ "$code" = "0" ]; then
        report ok "state_check.py: 台帳が空のリポジトリを違反にしない"
    else
        report ng "state_check.py: 空リポジトリ" "期待 exit=0 / 実際 exit=$code / $output"
    fi
else
    report ng "state_check.py" "fixtureがない: $STATE_REPO/work"
fi

# ------------------------------------------------------------------
# 3. 話またぎ逐語反復（repeat_check.py）
# ------------------------------------------------------------------
REPEAT_DIR="$FIXTURES/repeat"
# fixtureが踏むケース：
#   警告 12字以上の話またぎ逐語一致（「窓の外は霧と、霧越しの星だった。」）
#   抑止 allowlist登録済みの定型（「時間の止まった白い場所」）
if [ -d "$REPEAT_DIR" ]; then
    output="$(python3 scripts/repeat_check.py --all --strict \
        --drafts-dir "$REPEAT_DIR" --allowlist "$REPEAT_DIR/allowlist.txt" 2>&1)"
    code=$?
    got_warn="$(count_label "$output" 警告)"
    if [ "$code" = "1" ] && [ "$got_warn" = "1" ]; then
        report ok "repeat_check.py: allowlistで抑止し、残余を--strictで拒否 (exit=$code 警告=$got_warn)"
    else
        report ng "repeat_check.py: allowlistあり" \
            "期待 exit=1 警告=1 / 実際 exit=$code 警告=$got_warn"
    fi

    output="$(python3 scripts/repeat_check.py --all \
        --drafts-dir "$REPEAT_DIR" --allowlist "$REPEAT_DIR/no-such-allowlist.txt" 2>&1)"
    code=$?
    got_warn="$(count_label "$output" 警告)"
    if [ "$code" = "0" ] && [ "$got_warn" = "2" ]; then
        report ok "repeat_check.py: allowlistなしで全件警告、strictなしはexit 0 (警告=$got_warn)"
    else
        report ng "repeat_check.py: allowlistなし" \
            "期待 exit=0 警告=2 / 実際 exit=$code 警告=$got_warn"
    fi
else
    report ng "repeat_check.py" "fixtureがない: $REPEAT_DIR"
fi

# ------------------------------------------------------------------
# 4. 語彙飽和（vocab_check.py）
# ------------------------------------------------------------------
VOCAB_DIR="$FIXTURES/vocab"
# fixtureが踏むケース：
#   警告 監視語の1話上限超過（「測る」3回 > 上限2）
#   合格 上限内の監視語（「値踏み」1回 <= 上限2）
#   合格 監視リストがない場合は検査対象なしとして exit 0
if [ -d "$VOCAB_DIR" ]; then
    output="$(python3 scripts/vocab_check.py --strict \
        --watchlist "$VOCAB_DIR/watchlist.tsv" "$VOCAB_DIR/sample.txt" 2>&1)"
    code=$?
    got_warn="$(count_label "$output" 警告)"
    if [ "$code" = "1" ] && [ "$got_warn" = "1" ]; then
        report ok "vocab_check.py: 上限超過だけを警告し--strictで拒否 (exit=$code 警告=$got_warn)"
    else
        report ng "vocab_check.py: watchlistあり" \
            "期待 exit=1 警告=1 / 実際 exit=$code 警告=$got_warn"
    fi

    output="$(python3 scripts/vocab_check.py --strict \
        --watchlist "$VOCAB_DIR/no-such-watchlist.tsv" "$VOCAB_DIR/sample.txt" 2>&1)"
    code=$?
    got_warn="$(count_label "$output" 警告)"
    if [ "$code" = "0" ] && [ "$got_warn" = "0" ]; then
        report ok "vocab_check.py: 監視リストなしを検査対象なしとして許可 (exit=$code)"
    else
        report ng "vocab_check.py: watchlistなし" \
            "期待 exit=0 警告=0 / 実際 exit=$code 警告=$got_warn"
    fi
else
    report ng "vocab_check.py" "fixtureがない: $VOCAB_DIR"
fi

# ------------------------------------------------------------------
# 5. クリシェクラスタ検査（cliche_check.py）
# ------------------------------------------------------------------
CLICHE="scripts/cliche_check.py"
if [ -f "$CLICHE" ]; then
    if python3 "$CLICHE" --selftest >/dev/null 2>&1; then
        report ok "cliche_check.py: パターン回帰テストに合格"
    else
        report ng "cliche_check.py" "--selftest が失敗（パターンの回帰）"
    fi
else
    report ng "cliche_check.py" "スクリプトがない: $CLICHE"
fi

# ------------------------------------------------------------------
# 6. 戦闘・装備用語検査（combat_terms_check.py）
# ------------------------------------------------------------------
COMBAT_TERMS="scripts/combat_terms_check.py"
if [ -f "$COMBAT_TERMS" ]; then
    if python3 "$COMBAT_TERMS" --selftest >/dev/null 2>&1; then
        report ok "combat_terms_check.py: パターン回帰テストに合格"
    else
        report ng "combat_terms_check.py" "--selftest が失敗（用語・構造パターンの回帰）"
    fi
else
    report ng "combat_terms_check.py" "スクリプトがない: $COMBAT_TERMS"
fi

# ------------------------------------------------------------------
# 7. 比喩圧縮癖スイープ（metaphor_sweep.py・候補生成の回帰）
# ------------------------------------------------------------------
SWEEP="scripts/metaphor_sweep.py"
if [ -f "$SWEEP" ]; then
    if python3 "$SWEEP" --selftest >/dev/null 2>&1; then
        report ok "metaphor_sweep.py: パターン回帰テストに合格"
    else
        report ng "metaphor_sweep.py" "--selftest が失敗（候補生成パターンの回帰）"
    fi
else
    report ng "metaphor_sweep.py" "スクリプトがない: $SWEEP"
fi

echo ""
echo "結果: PASS $passes / FAIL $failures"
[ "$failures" -eq 0 ] || exit 1
