# セットアップ指示 — 受け取り側のGrokへ貼り付ける

`novel-Standard-template-grok.zip` と本ファイルを同じ空のディレクトリに置き、そのディレクトリでGrokを開始する。下の枠内をそのまま貼り付ければ、環境確認、展開、初期化、動作検証までが一度に進む。

---

==== ここからコピー ====

`novel-Standard-template-grok.zip` は、日本語長編Web小説を執筆するためのGrok用リポジトリです。次を順に実行し、既存ファイルを上書きせずにセットアップしてください。セットアップ中に小説本文は書かないでください。

1. 環境を確認する。`bash --version`、`python3 --version`（3.11以降）、`echo "あ" | grep -P "あ"`（`あ` が出力されること。出力されない場合はGNU grepではないので、検査スクリプトが動かない）。不足があれば何も変更せず報告する。
2. 同名の `novel-Standard/` が存在しないことを確認してからzipを展開する。`unzip` がなければ `python3 -m zipfile -e novel-Standard-template-grok.zip .` を使う。既存ディレクトリがあれば上書きせず報告する。
3. 展開された `novel-Standard/` に入り、そのディレクトリで Grok を使う前提で `chmod +x scripts/*.sh` を実行する（推奨起動: `grok --sandbox workspace`）。
4. `MANUAL.md` を読む。これが本リポジトリの取り扱いマニュアルである。冒頭に Grok Build と NovelAI 公式APIがあり、続けて作業の地図（本文を書く／書けた本文を加工する）、セットアップ、書き方の経路、PDF・漫画化が書かれている。以後は自動読込される `AGENTS.md` と、必要時の `MANUAL.md` に従って作業する。
5. `bash scripts/init-work.sh` を実行して `work/` と `world-bible/` を生成する。既存ファイルは上書きしないので、再実行しても安全である。
6. `python3 scripts/audit-repo.py` を実行し、`FAIL 0` を確認する。FAILが1件でもあれば内容を報告し、解消するまで執筆へ進まない。
7. 状態台帳の初期状態を確認する。

   ```bash
   python3 scripts/state_check.py
   ```

   初期化直後は本文も状態差分もないため、`state_check.py` は検査省略の情報行だけを出す。これは正常である。本文検査の実行スモークテストは手順6の `audit-repo.py` に含まれる。

8. `.agents/skills/` 直下のSkill名を一覧表示し、`MANUAL.md` にもとづいて「執筆を始めるには何を用意すればよいか」を3〜5行で説明して終了する。NovelAI を使う場合のトークン設置は任意であり、本セットアップでは `.env` を作らない。手順は `MANUAL.md` の NovelAI 節を案内する。

破壊的操作、外部インストール、既存ファイルの置換が必要になった場合だけ確認してください。

==== ここまで ====

---

セットアップ後の進め方は `MANUAL.md` を正本とする。世界観、キャラクターシート、視点計画、プロットを「執筆を始める前に凍結する設計」に従って作り、「第1話を書いて」または `/long-novel-orchestrator 第1話` で執筆へ入る。
