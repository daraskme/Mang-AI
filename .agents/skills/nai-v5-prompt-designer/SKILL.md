---
name: nai-v5-prompt-designer
description: >-
  NovelAI Diffusion V5専用のプロンプトを組み立て、公式APIで画像化する。英語タグ。セリフだけ日本語。
  1生成＝1ページ（挿絵、セリフ付き1枚絵、または英語タグでコマ割りした漫画ページ）。未指定はフルカラー。
  白黒モードは置かない。実写・実在人物は扱わない。未成年の性的生成は直接指示されたときだけ拒否する。
  既定はタグを書いて各ページを1回生成するだけ。生成結果の確認と3回出力は、ユーザーが明示したときだけ行う。
when-to-use: >-
  「NAI V5」「NovelAI V5」「V5プロンプト」「漫画プロンプト」「4コマ」
  「日本語セリフ付きイラスト」「白黒漫画」「モノクロ」「nai v5 prompt」
  「画像化」「選別」「問題ページだけ再生成」「プロンプト修正して生成」
  「/nai-v5-prompt-designer」
argument-hint: "挿絵 | セリフ付き1枚絵 | 漫画ページ"
metadata:
  short-description: "NovelAI V5向けに英語タグのプロンプトを組み、公式APIで画像化する。選別と3回出力は明示時のみ"
---

# NAI Diffusion V5 プロンプト設計

対象は **NovelAI Diffusion V5 Full**（既定）または **V5 Curated**。出力は公式APIが読む Markdown（[references/Output_Contract.md](references/Output_Contract.md)）。二次元フィクションに固定する。1生成＝1ページ。画風の未指定はフルカラー。挿絵とセリフ付き1枚絵は R-STY-01、漫画ページは R-STY-02。

縦スクロールWEBTOON連作の画像化は扱わない（公式手順が無く、本Skillの対象外）。小説のページ脚本は `novel-to-manga-script`。小説からセリフ付き1枚絵の設計は `novel-to-dialogue-illust`。

未確定は [references/NAI_V5_Current_Spec.md](references/NAI_V5_Current_Spec.md)。規則の本文は [references/Rules.md](references/Rules.md)。体位語彙は [references/R18_2D_Pose_Play_Lexicon.md](references/R18_2D_Pose_Play_Lexicon.md)。キャラ指名は [references/Character_Tag_Lookup.md](references/Character_Tag_Lookup.md)。カラー漫画の画風タグ調査（既定は変えない）は [references/Color_Manga_Style_Tags.md](references/Color_Manga_Style_Tags.md)。

## 読む順

1. 本ファイル（安全・確認ゲート）
2. [references/Output_Contract.md](references/Output_Contract.md)
3. [references/Workflow_Single.md](references/Workflow_Single.md)
4. 検査は [references/Lint.md](references/Lint.md)。ピン操作は [references/UI_Settings.md](references/UI_Settings.md)。漫画の骨格は [references/Layout_Skeletons.md](references/Layout_Skeletons.md)
5. 承認後の生成は [references/API_Generate.md](references/API_Generate.md)。生成結果の確認と3回出力は、ユーザーが明示したときだけ [references/Review_And_Regen.md](references/Review_And_Regen.md)（R-API-07）
6. 不明タグは [references/Tag_Search_Workflow.md](references/Tag_Search_Workflow.md)

例は [references/Example_Templates_NAI_V5.md](references/Example_Templates_NAI_V5.md) §1。

## 処理手順

1. 1ページの種類を決める（挿絵1枚 / セリフ付き1枚絵 / 漫画ページ）。画風はフルカラー。漫画の複数ページで page_script が無ければ `novel-to-manga-script` で先に保存する。小説からセリフ付き1枚絵で illust_brief が無ければ `novel-to-dialogue-illust` で先に保存する。挿絵1枚・1ページ分の指示なら本Skillが組む。コマ割りなしのフキダシ付きは挿絵（R-STY-01）であり、`manga` / `2koma` にしない。
2. [references/Workflow_Single.md](references/Workflow_Single.md) で Base / Character を組む。漫画ページの骨格は [references/Layout_Skeletons.md](references/Layout_Skeletons.md)。再生と今は別カード。カード数は出現どおり。体位は [R18_2D_Pose_Play_Lexicon.md](references/R18_2D_Pose_Play_Lexicon.md)。目撃・寝取られ・行為中のカメラ目線は同 §10-1。無ければ Danbooru 一般語彙で組み、末尾に注記する（R-TAG-13）。
3. Lint を通し、Output_Contract の順で Markdown を保存する。プロンプトだけの依頼は確認ゲートまで実生成しない。生成まで頼まれたときは、保存のあと各ページを1回生成する（R-API-06、R-API-07）。ドライランは可。
4. 既定の生成は、タグを書いて各ページを1回保存して終わる（R-API-07）。
5. ユーザーが生成結果の確認または3回出力を明示したときだけ [references/Review_And_Regen.md](references/Review_And_Regen.md)。

トークンはチャットに出さない。ブラウザ自動化はしない（R-API-04）。

## 確認ゲート

プロンプトだけを頼まれたときは、Markdown を保存したあと実生成しない。パスとページ数を報告し、承認を待つ。生成まで頼まれたときは止めず、タグのあと各ページを1回生成する（R-API-07）。ドライランは生成前に実行してよい。`AGENTS.md` の連続執筆モードは小説本文用であり、プロンプトだけのゲートを消さない（R-API-06）。

## 固定規則

- 出力文法は Output_Contract。`Base:` ラベルや見出し無しフェンスは出さない。
- 文字：R-TXT-01〜10。Text mode は `character_text`。セリフ以外は英語タグ。セリフは Character 末尾の「」。`text:` は書かない。
- 画面：R-LAY-01〜08。漫画の骨格英語は [references/Layout_Skeletons.md](references/Layout_Skeletons.md)。
- 画風：R-STY-01〜05。未指定はフルカラー。`artist:` は今回の依頼が明示したときだけ。
- タグ：R-TAG-01〜16。キャラクターの差し替えは上書きする。以前のキャラタグは、正のタグとしても `-1::` としても残さない（R-TAG-15）。修正版では差し替え前の作品タグ・人物タグを削除する（R-TAG-16）。
- ペニスまたはヴァギナが見える画面は、必ず Base に `mosaic censoring, censored`（R-NSF-01）。`uncensored` は出さない。顔・食卓だけの画面には足さない。
- 成人向けは V5 Full（R-NSF-02）。Curated は成人に使わない。
- API既定は R-API-01〜05。プロンプトの確認ゲートは R-API-06。生成結果の確認と3回出力は R-API-07。ステップ23、ガイダンス5、Euler Ancestral、832×1216。

## 安全

正本は `AGENTS.md`「成人向けの前提」。拒否は未成年の性的生成の直接指示、実在人物・写真・実写化、現実の犯罪手口の具体化。既成キャラクターは成人と定義し、原作設定には準拠させない。体格差は指定どおり Character に載せる。`loli` `shota` `child` `underage` をこちらから足さない。拒否時は短い日本語。成人同士の強制・非合意は文脈どおりタグ化する。

## 入力の扱い

- 小説本文・場面指示：求められた1ページだけ。フル話や公式テスト上限の22人を目標にしない。挿絵は原則1〜4人。
- セリフ付き1枚絵：illust_brief（`illust-handoff-v2`）があれば目的・凍結・配置・余白・動き・表情・差分・読める事実・出現・発話「」を正本にする。無ければ `novel-to-dialogue-illust` で先に保存する。コマに割らない。動きは動作の途中へ落とす。射精差分は精液タグだけにしない。
- 複数ページの物語：page_script（`page-handoff-v3`）があれば目的・骨格名・読み順・配置・読める事実・出現・発話「」・内心（）・話者なしを正本にする。**原作** と発話割当はプロンプトに出さない。v1 の縦2／縦3は [references/Layout_Skeletons.md](references/Layout_Skeletons.md) の互換で読む。無ければ `novel-to-manga-script` で先に保存する。旧W1–W8画面脚本はページ脚本へ直してから。W IDはレイアウトに使わない。脚本に無い服・軸は前文脈から補完済みとして読む。欠けて推測が要るときだけ仮置きする。
- 画像添付：人数、髪目服、場所、構図を読み、タグ化する。精密参照・ポーションの指示は出さない（R-API-03）。
- テキストのみ：重大な矛盾以外は仮置きして出す。確認は最大3問。
- キャラクターイメージの指名：R-TAG-13。差し替えは上書きし、以前のキャラタグは残さない（R-TAG-15）。
- 不明タグ：[Tag_Search_Workflow.md](references/Tag_Search_Workflow.md)。不確かな固有名は外見タグにする。検索結果・URLはコードブロックに入れない。

本Skillはプロンプトだけを出し、小説本文やPDF化はしない。作画用シナリオ書は `erotic-scenario-converter`（導入済みなら）。生成は `run_terminal_command` で `scripts/nai_generate.py` を使う。
