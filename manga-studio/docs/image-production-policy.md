# 単独画像制作の方針 — A1 4B用

2026-10-06。漫画以外の一枚絵・背景・動画の先頭画像を作る手順。漫画は [漫画制作の方針](manga-production-policy.md)、動画化は [動画制作の方針](video-production-policy.md) を使う。これはMang-AIの運用規則であり、モデル公式の必須プロンプト文法ではない。

## overview — 工程と担当

`依頼と選択モデルの確認 → Gemmaで作画プロンプト → Krea2/Kromaで生成 → 画像確認・修正 → 必要なHires → 保存`

A1は進行・ツール操作・利用者への報告を担当し、自然言語の作画プロンプトは創作用Gemma Ortenzyaへ依頼する。UNSEENは学習素材のキャプション担当、Qwenはコーディング担当。計画やプロンプトだけの依頼では生成を始めない。

| 工程 | 次の操作 | 完了の証拠 |
|---|---|---|
| prepare | `media_model_catalog` / `media_model_select` | モデル、LoRA、強度、用途と依頼内容が一致 |
| prompt | `media_prompt(provider:krea)` | 保存IDと非空のprompt |
| generate | `krea_generate` → `media_job` | completedと回収したoutputPath |
| review | 画像表示、必要な改稿・編集・拡大 | 対象版と変更点、採用結果 |
| save | `media_open_gallery` | 採用画像と生成条件を再参照できる |

着手時はこのoverview、工程が変わるときは `media_workflow_guide(workflow:image, section:工程名)` で必要部分だけ読む。返されたIDをそのまま使い、同じ処理を再投入しない。

## prepare — 依頼と生成条件を固定する

被写体、人数、外見・衣装、場所、見せたい一瞬、構図、画風、縦横比・用途、枚数、保持する参照情報を整理する。未指定の軽微な点は既存の設定を使い、重要な人物・画風の指定を勝手に追加しない。

`media_model_catalog(provider:krea)` で一覧と現在の選択を読む。指定されたモデルと人物/Style LoRAを `media_model_select` に保存する。LoRAの `role:character/style/other`、強度、有効状態、登録されたトリガーを区別する。IDやトリガーを推測せず、見つからない指定を別モデルで代用しない。LoRAを使わない指定では `loras:[]` を明示する。

サーバー未起動なら `media_service(provider:krea, action:start)`、続いて `media_status(provider:krea)`。startingは準備中なので再起動を重ねない。古いキャッシュしかない一覧は準備完了後にrefreshする。参照画像を見ていない場合は見たと報告しない。現在の `krea_generate` はテキスト生成で、任意の参照画像を入力する引数はない。

## prompt — Gemmaへ一枚の設計を渡す

`media_prompt` のinstructionへ依頼、contextへ確定した人物・背景、構図、トリガー、変える点・残す点を渡す。選択モデルとLoRAはツールが引き継ぐ。Gemmaの返すnotesに依頼との矛盾や未決の重要事項があれば先に解消する。

基本順は「主題と場面 → 人物の外見・衣装 → 一瞬の動作・表情 → 背景・小物 → 構図・光・画風」。具体的な英語の自然文で4000文字以内。これは運用上の整理順で、タグの羅列や複数時点を一枚へ詰め込まない。日本語の台詞や吹き出しを絵へ焼き込まない。文字入れが必要なら別の編集工程として扱い、漫画の場合は専用文字ツールへ渡す。

出力のpromptと保存IDを保持する。初稿と修正稿を区別し、次工程にはGemmaの実際の返り値を渡す。創作プロンプトを作っただけで「画像を生成した」と報告しない。

## generate — 一度投入し、同じジョブを追う

GPU・RAM負荷を通知し `gpu_status` を確認する。Gemmaの応答が保存され、共通キューが生成工程へ切り替える順を守る。`krea_generate` にprompt、必要なサイズ・seed・presetを渡す。モデル・LoRAは保存済み選択を使い、明示引数で不用意に上書きしない。幅・高さは16の倍数。Kromaの現行プリセットはturbo8。他モデルのstepsは導入済み環境とモデルの条件を使い、量子化名だけで最適値を決めない。

返されたidを `media_job(id, action:status)` で追跡する。queued/runningでは同じ生成を追加しない。completedとoutputPathが揃ってから結果を示す。失敗時はエラーと入力を保持し、原因を直してから再試行する。中止は対象idへaction:cancel。接続が切れたら再接続後に元のidを調べる。

## review — 修正と仕上げを選ぶ

確認対象は人物数・外見・衣装、ポーズと手、小物、構図、背景、指定LoRA、不要な文字、利用者の修正点。実際に画像を見られた範囲だけを確認済みとする。自動で何度も再生成しない。

| 修正内容 | 手段 |
|---|---|
| 構図、人物、動作、画風 | 元promptと保持する点をGemmaへ渡して改稿し、Kreaで新規生成 |
| 局所の不要物や欠損 | `media_open_editor(path:outputPath)` → `media_edit(mode:inpaint)` → `media_edit_status` → 採用時 `media_edit_commit` |
| 手作業のマスク・モザイク | 同じ編集GUI。自動処理はmedia_editで対象を指定 |
| 解像度と細部の仕上げ | 採用候補のidに `media_upscale`、新しいidをmedia_jobで追跡 |

IOPaint/LaMaはマスク周辺からの補完で、文章の意味に沿う画像編集ではない。Kreaのmedia_upscaleは低denoiseで再生成するHires（現在の既定は1.5倍、4step、0.25）で、顔や細部が変わり得る。拡大前後を比較して採用する。これらは現在の設定値であり、全モデルに最適と検証された値ではない。

## save — 結果と条件を残す

セッションにはGemmaの依頼・応答、生成引数、ジョブID、回収画像が保存される。Hiresは親ジョブへの参照を持つ別ジョブ、編集は別版として残る。A1は採用版のID・パス、seed、モデル/LoRA、残っている修正事項を報告する。ギャラリーは `media_open_gallery`、手動生成は `media_open_generator`。

再開時は会話の保存IDとギャラリーで対象を特定し、元のmedia_jobを確認する。IDを失ったまま再生成せず、記録から対象を回復する。現在、全制作工程を自動で再開する状態機械はなく、IDと依頼範囲をA1が引き継ぐ。画像の採用版を動画にするなら、動画手順のfirstFramePathへ渡す。

## gpu — 常駐モデルと切替

`A1常駐 → Gemmaでプロンプト → 保存・Gemma解放 → Krea/Kroma生成 → 解放 → 必要な編集/Hires`

高負荷処理の直前に内容を短く通知する。指定済みの処理について通知のためだけの再承認は求めない。空き不足はgpu_statusで確認し、待ち状態と必要量を伝える。VMは利用者が停止する。A1、別セッションのジョブ、他アプリを終了しない。GPUキューに待機中ならモデル切替を手動で競合させない。
