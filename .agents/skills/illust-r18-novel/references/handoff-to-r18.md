# novel-write-r18 への引継ぎ

本Skillは行為シチュと挿絵配置を決め、**文の官能的厚みは `novel-write-r18` に任せる**。描写体系をここに複製しない。

## 1. 渡すもの（設計ブロック）

```
【illust-r18-novel 引継ぎ】
視点：三人称一元・（人物名）
モード：標準Web / 会話主体 / 文芸主体
注意書き：ファイル先頭に ※※※ でフィクション・非実在・全員成人（output-format 定型）
成人根拠：（各人物・設計用。物語地の文での年齢確認シーンは不要）
許可／強制の範囲／フィクション装置：（設計用。作中に無い安全語の説明・唱和はしない）
関係性と感情の開始→終了：
場所：
衣装／キャラ名：
体格差：（小柄／大柄など、見たまま。均さない）
許可された行為範囲：（画像列から）
開始状態：
終了状態：
挿絵順：
  1. ファイル — phase — 本文で必ず拾う視覚点
  2. …
橋渡しで補う動作：（最小）
核イメージ案：（任意・1つ）
♡・記号：（作品既定）
```

## 2. 渡さないもの

- 画像バイナリそのものの再解釈を本文Skillに丸投げする依頼だけ
- scene-card に無い長編正典の変更

## 3. 本文Skill側の読み順

1. `novel-write-r18` の safety-and-inputs
2. 本Skillの safety-and-framing（体格差）
3. 引継ぎブロック
4. 選んだモード + shared-craft（必要分の pattern-bank）
5. `novel-write-r18` の `vocab-remap.md` の該当カテゴリだけ（挿入〜抽送なら S1/S3/S9/P1/P2/P7）

## 4. 長編 write-episode へ載せる場合

1. 引継ぎブロックを `work/scene-cards/ep<NNN>.md` の GMC・状態差分・R18境界・must_use_facts に転記する
2. 挿絵マーカー規約を scene-card の備考へ書く
3. `write-episode` Step 2 で R18 場面として `novel-write-r18` を使う
4. 本文保存先は `work/drafts/episode<NNN>.txt`
5. 以降の検証・台帳は通常の write-episode 完了定義に従う（`validate-episode` 修正モードを含む）

## 5. 本文後の検証（単独短編）

1. 本文パスを `validate-episode` へ渡し、修正モードで実行する
2. 描写Skillへ検証・診断・改稿を依頼しない
3. `ai-novel-detector` と `humanize-ai-writing` は `validate-episode` が呼ぶ
4. 完了判定は `AGENTS.md` の単独短編向け読み替えに従う

## 6. 役割の切り分け（衝突時）

| 論点 | 正本 |
|---|---|
| 誰が何をしたか（行為の骨格） | 画像列＋本Skillの挿絵計画 |
| どう感じ・どう崩すか（描写） | novel-write-r18 |
| 地の文の部位・行為の言い換え | novel-write-r18 の vocab-remap.md |
| 長編の前後関係・情報格差 | plot / pov-plan / write-episode |
| 記号・空行・ルビ | guidelines/01 |
| 機械検査・台詞監査・文体診断・接地改稿 | validate-episode（単独短編は illust-r18-novel が修正モードで呼ぶ） |
