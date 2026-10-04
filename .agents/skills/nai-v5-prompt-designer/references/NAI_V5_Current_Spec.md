# NAI Diffusion V5 仕様（2026-08-29確認）

目次：§1 モデル / §2 ハイブリッド / §3 文字 / §4 新規タグ / §5 継承構文 / §6 品質・UC / §7 運用 / §8 未確定 / §9 コミュニティ注意。カラー漫画の画風タグ調査は [Color_Manga_Style_Tags.md](Color_Manga_Style_Tags.md)（既定は R-STY。このファイルは変えない）。

情報源の優先順：V5公式リリース記事 → V5対応済み公式Docs → 公式テスター → 公式作例 → 複数ユーザー検証 → V4.5継承 → 単独推測。

確度：`official_v5` / `official_legacy` / `official_tester` / `ui_measured` / `community` / `experimental` / `unknown`。

一次情報（V5）：

- https://blognew.novelai.net/novelai-diffusion-v5-release-jp-343211a45664/ （日本語公式。引用符・日本語タグ名・ポーション呼称の正本）
- https://journal.novelai.net/image-generation-novelai-diffusion-v5-is-here-c2df7c6b8d2d/
- https://blog.novelai.net/subscription-updates-usage-limits-jp-2025-fc440e402467
- https://blog.novelai.net/subscription-updates-usage-limits-2025-88a208d5d9c5
- https://docs.novelai.net/en/image/textrendering/
- https://docs.novelai.net/en/image/qualitytags/ （V5 Full / Curated の Quality Tags 本文。2026-09-19確認）

継承仕様の正本は `docs.novelai.net`（2026-08-21時点はV4.5記述が残る）。DocsがV5に追随したら本ファイルの「継承」「未確定」を再検証する。

## 1. モデル（official_v5）

- V5 Curated と V5 Full を同時リリース。本Skillの小説挿絵・成人は **V5 Full**。
- V4.5より大きい独自アーキテクチャ。32ch カスタムVAE。細線・瞳・アクセサリ・文字の精度が上がる。
- 英語・日本語を公式サポート。他言語はテスター報告あり、ばらつく。
- プロンプト長はV4.5より拡張。UI実測の合計上限は **1471トークン**（[UI_Settings.md](UI_Settings.md)）。
- キャラクタープロンプトはテストで最大22。配置はキャンバス自由配置（旧5x5グリッドではない）。生成結果エリア上で番号ピンをドラッグする。任意でグリッド線。ピン座標の出し方は [UI_Settings.md](UI_Settings.md)。配置は構図だけでなく同一性と bleed 抑制にも効く。配置なしでも絡みはV4.5より自然。使わないカードは削除（無効でもピンが残る）。
- キャラクタープロンプトに名前を付けられるが、メタデータ保存・再インポートでは消える。同一性は Skill の `## キャラ固定` で持つ。
- アルファ透過ネイティブ。
- 漫画：自然言語またはキャラクター配置で、複数コマのページを一度に生成できる（公式発表）。本Skillは1生成＝1ページ。縦スクロールWEBTOON連作は対象外。
- 2026-08-22、公式は **0より大きく1より小さい数値強調** が一部要素を過剰に強める不具合を修正した。修正前の `0.2::` / `0.5::` 実験は同じSeedで再試験する。
- 品質向上（Enhance）に Max✨。アップスケーラ単体でも使える。Inpainting は **V5 Full のみ**。Curated は当面 V4.5 Curated のインペイント。
- **精密参照（Precise Reference）/ Curated インペイント / NovelAIポーション（Vibe Transfer）はローンチ時点で未対応**（後日予定）。Style Reference は精密参照の一形態として同じ扱い。参照画像スロットに出るのは **i2i のみ**（[UI_Settings.md](UI_Settings.md)）。

## 2. ハイブリッド（official_v5）

タグは簡潔さと一貫性のため完全サポートのまま。自然言語理解はV4.5から強化。

公式は日本語自然文も通ると発表している（「頭に浮かんだ日本語をそのままプロンプトに書ける」）。本Skillの組み立ては英語タグ。日本語はセリフの「」だけ。場面文を日本語自然文にしない。組み立ては [Workflow_Single.md](Workflow_Single.md)。規則は [Rules.md](Rules.md)。

V4.5解説の「日本語はT5対象外」は **V5に持ち込まない。**

## 3. 文字（official_v5、手順の細部は official_legacy）

- 英語・日本語・中国語などの画像内文字。公式Docs（Text Rendering）：V5 Curated 374字、V5 Full 750字（空白・改行込み）。短い文字は Quality Tags の `no text` と衝突しうる。
- 描きたい文字を `「こんにちは」` または `"こんにちは"` で囲むと、フロントエンドが `Text:` を自動準備する。公式日本語記事は **かぎ括弧を先に**。本Skillの既定は Character 末尾の `「」`（`character_text`）。API送信時に `Text:` へ分離する。同じ行に `text:` と書かない。Base に「」を置かない。
- 手順は R-TXT。[Workflow_Single.md](Workflow_Single.md)。

## 4. V5新規タグ（official_v5）

| タグ | 用途 |
|---|---|
| `depthness` | 陰影の奥行き |
| `attractive male` | 魅力的な男性 |
| `low complexity` / `medium complexity` / `high complexity` / `ultra complexity` | 複雑さ。通常は `high complexity`。ultra/low は様式化寄り。ultra＝最高品質ではない |
| `transparent background` | 背景透過。公式ヒント：`2.1::transparent background::` |
| `alpha transparency` | 炎・魔法・ガラスなど物体の半透明 |
| `has alpha` | アルファを何かの形で使う、より抽象 |
| `meta:novel era` | やや古め |
| `meta:golden era` | やや現代寄り |
| `visual novel art` / `visual novel bg` / `visual novel cg` / `visual novel chibi` / `visual novel sprite` | VN風 |

透過3タグを用途で使い分ける。詳細背景と `transparent background` は衝突。公式ヒントは日本語名でも可：`2.1::透明な背景::`。英語名と日本語名を同じ概念で並べない。

公式日本語記事の併記（出力は英語タグ既定）：

| 日本語名 | 英語タグ |
|---|---|
| 奥行き | `depthness` |
| 魅力的な男性 | `attractive male` |
| 低複雑度 / 中複雑度 / 高複雑度 / 超複雑度 | `low complexity` 等 |
| 透明な背景 | `transparent background` |
| アルファあり | `has alpha` |
| アルファ透過 | `alpha transparency` |
| ビジュアルノベル風イラスト / 背景 / CG / ちびキャラ / 立ち絵 | `visual novel art` 等 |

## 5. 継承構文（official_legacy、V5でも当面有効）

| 記法 | 効果 |
|---|---|
| `{tag}` | ×1.05。入れ子で乗算 |
| `[tag]` | ÷1.05 |
| `1.5::tag ::` | 数値強調。`::` で終了し、開き括弧も閉じる |
| `-1::tag ::` | 負の数値強調（ピンポイント除去・概念の反転）。広い回避はUC |
| `(tag)` | **無効**。出さない |

UC欄では `{ }` が「より除外」、`[ ]` が「除外を弱める」。

人数タグは Base のみ。Character は `girl` / `boy` / `other`。並びは上→下。UI配置とプロンプト順を矛盾させない。漏れはキャラごとの UC。

Action：`source#hug` / `target#hug` / `mutual#hug`。公式注記どおり常に安定しない。本Skillは英語タグと `source#` のみ（R-TAG-04）。1キャラ1アクションを原則（community）。

`|` 区切りと UI Character Prompt は同時使用禁止。

データセット：モード ケモノで UI がプロンプトへ追加する。Base に `fur dataset,` を繰り返さない。`background dataset,` は人物なし写真調。二次元人物では使わない。

改名タグ例：`peace sign`（旧 v）、`character image`（旧 tachi-e）。

年次：`year 2018` 〜 `year 2026`。現行寄りにするなら `year 2026`。既定画風と併用するときは必須ではない。

## 6. 品質タグ・UCプリセット（official_v5 / UI実測と一致）

公式Docs（Quality Tags、2026-09-19確認）と UI 実測は一致する。テスター実測（2026-08-21）。UI表記の「Quality Tags: 標準」と一致する。

Quality Tags の UI は **標準 / 軽い / 指定なし**。V4.5 Full の `location` は標準から外れている。タグはプロンプト末尾へ自動付与され、入力欄には見えないがトークンは消費する。

| UI | 自動付与（公式Docs = 実測） |
|---|---|
| 標準 | `very aesthetic, masterpiece, no text` |
| 軽い | `very aesthetic, amazing quality, no text` |
| 指定なし | 付与しない |

標準・軽いとも `no text` を含む。**画像内文字付きは指定なし。** 本文は [Lint.md](Lint.md)。挿絵の画風は R-STY-01、漫画ページは R-STY-02。

UC Preset の UI は **強い / 軽い / ケモノモード / 人間に重点を置く / 指定なし**。強い≒Heavy、人間に重点を置く≒Human Focus は V4.5 Full と同文。UC の軽いは別物（`sepia, white haze, 0::ai-generated`）。漫画既定は指定なし＋自前UC。ラベルと解像度・Anlasの正本は [UI_Settings.md](UI_Settings.md)。

品質ポリシー：`off_for_text`（画像内文字）/ `ui_default`（文字なし単体）/ `custom`。

## 7. 運用

ブラウザ操作・既定値・解像度・Anlas の正本は [UI_Settings.md](UI_Settings.md)。公式画像API（ブラウザ自動化ではない）は [API_Generate.md](API_Generate.md)。モデル文字列 `nai-diffusion-5-full` は community。

Opus の使用量制限は **V5 のみ**。通常解像度・**28ステップまで**が充電池。UI既定ステップは **23**。大サイズ以上や28超は Anlas。参照画像は i2i のみ。

## 8. 未確定（unknown）— 固定知識にしない

- UC Preset の公式Docs本文（UI実測は §6 と [UI_Settings.md](UI_Settings.md)。Quality Tags の V5 本文は公式Docs済み）
- ステップ・ガイダンスの画質最適値（UI既定は 23 / 7 / Euler Ancestral。本Skill漫画は 23 / 5。公式Docsはガイダンス5–6。V5推奨サンプラーは Euler Ancestral のみ、とコミュニティ記事）
- Artist タグのV5最適weight
- 全 Action タグの成功率
- キャラ数の実用上限
- 精密参照 / NovelAIポーションのV5提供時期
- 公式画像APIのモデル文字列（community は `nai-diffusion-5-full` / `nai-diffusion-5-curated`）
- 引用符方式と手動 `Text:` を混在させたときのフロント挙動の端数（混ぜないのが正）
- 縦4コマを安定して縦一列にする条件（community：2×2になりやすい）
- `right-to-left comic` タグの実効性

## 9. コミュニティ注意（community / official_tester）

調査日 2026-08-21。追記 2026-08-28〜29。公式テスターの公開作例と公開UIを参照。公式リリース同日の記事。精密参照 / ポーションは同日時点でも V5 未対応と明記。文字の切り分けは公式Docs Text Rendering と公開解説。

- V4.5プロンプトの生移植は絵柄が崩れることがある。再チューニングする。
- Artist Mix をV5へ自動移植しない。
- コンテキスト拡大で異物混入の報告あり。重複タグを削る。
- 同一欄に日本語の文と英語タグを混在させて通る、という報告がある。本Skillは英語タグを既定にし、日本語はセリフの「」だけにする。`text:` を英語タグと同じ行に置くと、`speech bubble` 等が描き文字になる。
- 日本語だけでも髪目服・ポーズ・遠近・背景は概ね通る、というテスター報告。漫画の精度は英語タグが上（実測）。
- 画風の既定は挿絵が R-STY-01、漫画ページが R-STY-02。`artist:` は今回の依頼が明示したときだけ。本Skillは白黒ページを出さない。カラー漫画の画風タグ調査（2026-09-19、現状維持）は [Color_Manga_Style_Tags.md](Color_Manga_Style_Tags.md)。
- 2026-08-30 community：プロンプトは内容、UIピンは位置。ピン無しだとコマ割りが崩れる。3〜4コマが現実的。日本語のページ作文は本Skillでは使わない。日本語生成でふりがなが混入する報告（文字付きUCへ `furigana`）。話者ごとの吹き出し色は系統失敗時の1軸。
- 2026-09-07〜08 community：`2koma`/`3koma`/`4koma` だけでは等分の段になりやすい。ページ→段→列→入れ子の英語を置き、ピンと併用すると非対称骨格が再現しやすい。YAML は使わない。本Skillの原文は [Layout_Skeletons.md](Layout_Skeletons.md)。
- 手書き文字・オノマトペが崩れにくい、というテスター体感。吹き出しは短く保つ。擬音タグは R-TXT-06。
- サイズ差の作例の UC に `chibi`。漫画既定 UC は [Lint.md](Lint.md)。体型の `short` とは別。
- コマ内容の入れ替わり・融合・ふきだし誤配置は利用者報告がある。プロンプトだけで100%固定できるとは扱わない。
- 2026-09-16 実測（縦3の上下、上大＋下2の左右下段）：隣接コマの Character が同じ画角・`looking at another`・動作なしだと、`top panel` / `bottom panel` を付けても同じ立ち絵を複製する。対策はコマごとの動作タグ（Character 側の `1.5::`）とカメラ差。1コマだけのキスを Base に置くと全コマがキスになる。
- 座標配置で三連画のような構図も組める。ピンの目安は肩。
- ステップ 20–23。ガイダンスは 5.0 前後がコミュニティ推奨。V5 の推奨サンプラーは Euler Ancestral のみ、という記述。
- 実写避けの任意ロック：Base に `-2::realistic::`。鮮やかさは `-0.8::muted colors::`。既定画風＋UC realism と併用するときは必須ではない。
- 複雑度は公式どおり通常 `high complexity`。`ultra complexity` は様式化。
- サイズ差の作例に `miniboy`。本Skillは依頼の体型語（`petite`, `short`, `size difference` 等）を落とさない。
- 2026-09-16 community：行為は Character 側へ `1.5::` / `2::` の数値強調、反対行為は同じ Character の `-1::`。カスタム配置のほうが成功しやすい。短い英語の動作文も Character に通る報告がある。本Skillの組み立ては英語タグ既定。
- 2026-09-03 community：単純な2人関係は自然言語だけでも前後が描ける作例あり。`source#` / `target#` は必須ではない。役割を人物別に固定したいときだけ使う。
- 2026-09-12 community：一括ページで、台詞は `speech bubble containing` ＋ `Text:`、効果音は `free-standing handwritten manga sound effect text` で別文。効果音を `Text:` に入れると吹き出しと描き文字が混ざる。本Skillは英語タグ既定のまま、擬音だけ `sfx「」` で残す（R-TXT-06）。見出し付きの自然文プロンプトや `cel shading` は採用しない。
- 2026-09-07 community：コマ割り画像の i2i は強度 0.66 前後と `high complexity` が骨格を残しやすい。`ultra complexity` や 0.7 は描き込みが増えて枠が崩れやすい。通常生成は i2i を使わない。
- 2026-09-02〜22 community：拘束は `suspension` / `hogtie` / `breast bondage`。女性上位の関係は `femdom`（体位タグの代わりにしない）。がに股は `bowlegged pose`。肩紐のずれは `strap slip` / `double strap slip`。`narration` は四角の説明枠になるので、漫画ページには足さない（`-1.5::caption ::` のまま）。
- 2026-08-28〜30 community：大きな胸のシャツは `tented shirt`。座位の補助は `wariza` / `sitting`。着衣を残すときは `clothes down` やずらしであり、無指定の `nude` にしない。サイズ差の作例はピンを肩付近へ。
- 2026-04-22 community：背面座位は `reverse upright straddle`。スカートを残す補助は `convenient skirt`（ずらし指定があるときは使わない）。
