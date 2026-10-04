#!/usr/bin/env bash
# 新規作品の初期化（リポジトリをコピーした直後に1回実行する）
# 使い方:
#   bash scripts/init-work.sh
# やること:
#   - work/ に pov-plan / plot / beat-sheet / style-samples と各台帳の雛形を templates/ から配置
#   - work/scene-cards/ work/drafts/ work/continuity/ を作成
#   - world-bible/ に索引・時系列・確定事項ログの雛形と core/ ondemand/ を作成
# 既存ファイルは上書きしない（再実行しても安全）。
set -euo pipefail
cd "$(dirname "$0")/.."

copy_if_absent() {
  if [ -e "$2" ]; then
    echo "スキップ（既存）: $2"
  else
    cp "$1" "$2"
    echo "作成: $2"
  fi
}

mkdir -p work/scene-cards work/drafts
mkdir -p work/continuity/episodes work/continuity/checkpoints
mkdir -p world-bible/core world-bible/ondemand world-bible/log

copy_if_absent templates/pov-plan.md   work/pov-plan.md
copy_if_absent templates/plot.md       work/plot.md
copy_if_absent templates/beat-sheet.md work/beat-sheet.md
copy_if_absent templates/style-samples.md work/style-samples.md
copy_if_absent templates/current-state.md work/continuity/current-state.md
copy_if_absent templates/phrase-allowlist.txt work/continuity/phrase-allowlist.txt
copy_if_absent templates/cliche-allowlist.txt work/continuity/cliche-allowlist.txt
copy_if_absent templates/sweep-adjudicated.tsv work/continuity/sweep-adjudicated.tsv
copy_if_absent templates/pending-decisions.md work/continuity/pending-decisions.md
copy_if_absent templates/vocab-watchlist.tsv work/vocab-watchlist.tsv
copy_if_absent templates/motif-dictionary.tsv work/motif-dictionary.tsv
copy_if_absent templates/world-bible-index.md world-bible/00-INDEX.md
copy_if_absent templates/timeline.md world-bible/core/08-timeline.md
copy_if_absent templates/canon-log.md world-bible/log/canon-log.md

echo ""
echo "初期化完了。次の手順："
echo "  1. world-bible/core/ ondemand/ を templates/world-bible.md §3 に従って作成"
echo "  2. POVキャラの character-sheet を作成: cp templates/character-sheet.md work/character-sheet-<キャラ名>.md"
echo "  3. work/pov-plan.md → work/plot.md の順に設計して凍結"
echo "  4. 1話ごとに: cp templates/scene-card.md work/scene-cards/ep001.md"
echo "  5. 本文確定後: templates/episode-state-delta.md を work/continuity/episodes/ に配置して状態差分を記録"
echo "  6. 第3話まで書けたら work/style-samples.md を実際の本文から埋めて文体を凍結"
