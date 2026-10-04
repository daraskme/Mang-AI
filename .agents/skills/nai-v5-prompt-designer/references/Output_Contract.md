# 出力契約

`contract: output-v1`

本契約が正。`scripts/nai_generate.py` は本契約に追随する。実装と食い違う記述は本ファイルを直す。

`scripts/nai_generate.py`・`scripts/nai_adopt.py`・`templates/nai-api.env.example` は Skill ZIP に含めない（トークン経路の意図的分離）。リポジトリ同梱分を使う。

ドライランは契約違反を検出する（[API_Generate.md](API_Generate.md)）。

## 文書順

1. 日本語免責 2〜4行（コードブロックにしない）。既定：
   以下はNovelAI Diffusion V5用のプロンプト案です。生成結果の利用・公開・二次利用はユーザー自身の責任で行ってください。
   意図せず不適切な内容が生成される可能性があります。NovelAIの利用は18歳以上を前提とします。
   出力は二次元フィクションイラスト向けです。実写・実在人物は対象外です。
   精密参照と NovelAIポーションの提供状況は NAI_V5_Current_Spec を正とする。
2. `## 設定`（文書に1つ。次の `##` まで）
3. 連続ページなら `## キャラ固定`（文書に1つ。髪目、服の色、体格差の錨）
4. ページごとに `## ページN`（Nは1始まりの整数。APIが読む。1ページ＝1生成）
5. 根拠・Lint警告は、ユーザーが求めたとき、または衝突があるときだけ、全ページのあと

`## ページN` のあいだに説明文を置かない。

## ページ内（この順）

ゴールデンサンプルは [Example_Templates_NAI_V5.md](Example_Templates_NAI_V5.md) §1。各ページは次の見出しだけをこの順で置く。

1. `## ページN`
2. `### Base` の直後にフェンス（` ``` ` または ` ```text `）。1フィールド。カンマ＋半角スペース。見出し・番号を中に置かない
3. `### Undesired Content` ＋フェンス
4. 人物がいれば `### Character 1` ＋フェンス。2人目以降は `### Character 2` …
5. `## 配置` とそのページのピン表

- 見出しは `### Base` / `### Undesired Content` / `### Character N`（Nは整数。タブまたは空白1つ以上）。別名（`Base:`、`UC:`、`## Base`）は契約外。パーサは読まない。
- フェンスは ` ``` ` または ` ```text `。本文はフェンス内だけ。
- Character がいない画面は Character 見出しを出さない。使わないカードは削除する（無効だけだとピンが残る）。
- `## 配置` は **その `## ページN` の配下**（次の `## ページ` より前）。文書末に1表へまとめない。
- x, y は 0–100 の整数。左上原点。プロンプト文字列へ座標を埋め込まない。ピン番号＝Character 番号。有効列は `オン` / `オフ` / `有効` / `無効`。
- ピン表が無いときの位置語（`Character 1 上段` 等）はパーサが読む。漫画ページと複数 Character ではピン表を書く。

## `## 設定` のラベル

1行1項目。`- ラベル: 値`。パーサが読むキー：

| ラベル | 値の例 |
|---|---|
| モデル | `NAI Diffusion V5 Full` / `V5 Curated` |
| モード | `アニメ` / `ケモノ` |
| 画風 | `フルカラー`（Skill側。パーサは無視してよい） |
| Quality Tags | `指定なし` / `標準` / `軽い` |
| UC Preset | `指定なし` / `強い` / `軽い` / `ケモノモード` / `人間に重点を置く` |
| 透過背景 | `オフ` / `オン` |
| 位置 | `カスタム` / `AIにおまかせ` |
| 解像度 | `普通サイズ 832×1216` |
| ステップ | `23` |
| プロンプトガイダンス | `5` |
| サンプラー | `Euler Ancestral` |
| Text mode | `character_text` |

既定値とピン操作は [UI_Settings.md](UI_Settings.md)。漫画の骨格とピン目安は [Layout_Skeletons.md](Layout_Skeletons.md)。品質政策は [Lint.md](Lint.md)。規則は [Rules.md](Rules.md)。

## Text:

- `character_text`：セリフは話者 Character の末尾 `「」`。同じ行に `text:` と書かない（R-TXT-01）。
- スクリプトが「」をタグ行から抜いて Character プロンプト末尾へ `Text:` を付ける。2つ目以降は `Text:` を繰り返さず本文行だけ足す。
- 手動で `text:` をタグに混ぜない。ドライランで `Text:` が日本語のみか見る。
- ゴールデンサンプルは [Example_Templates_NAI_V5.md](Example_Templates_NAI_V5.md) §1。
