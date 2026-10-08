# LoRAの参考サムネイル

ギャラリーの「モデル・LoRA」画面で、各カードから設定できます。PNG/JPEG/WebP/AVIF（6MB以下）のアップロード、対応する学習資料の選択、差し替え、解除に対応します。画像の種類は「参考画像」「学習データの参考」「LoRAの生成例」を選べます。種類はアップロード時に保存されます。

学習資料を選ぶと640ピクセル以下のプレビューを別に作ります。H3の動画は先頭フレームを使います。原画像・動画・LoRA重みは変更しません。学習資料のサムネイルはLoRAの出力品質や動きの評価を表しません。生成例は利用者がそのLoRAの結果と確認できた画像に設定してください。

サムネイルは全セッション共通で、モデルとLoRAの選択はセッションごとです。A1からは `media_model_catalog` のkeyを使い、`media_model_thumbnail(action:candidates)` で候補確認、`action:set, file:絶対パス, kind:training` で設定、`action:clear` で解除します。データセットと生成物の保存先以外の任意ファイルは読み込めません。

全ての登録済みLoRAで新しい実生成サンプルを作る場合（GPUを使用）:

```bash
cd manga-studio
node scripts/generate-lora-previews.mjs --run
```

Krea2は公式Turbo・768×768・8 steps、H3は704×704・124 frames・Turbo 8、seed42、各対象LoRAの強度0.8。毎回新規出力し、完成と使用LoRAの記録を確認したものだけサムネイルを差し替えます。H3には専用の高速化LoRAも適用します。サンプルの生成条件と元画像／動画は保存され、学習資料とは区別されます。

設定DBは `dataDir/studio.sqlite`、画像とバッチ報告は `dataDir/.model-thumbnails/`。個人画像なのでGitHubには含めません。表示設定を保存する場合は停止中のDBとこのフォルダを一緒に保管してください。`prepare-model-thumbnails.mjs` は学習資料から参考画像を作る別用途のCPUツールで、実生成を行うものではありません。

## 全件の新規生成（2026-10-09）

Krea2 24個・H3 8個を全件新規生成し、32個すべてを `generated` として登録しました。Krea2は指定に合わせて海と水着の成人女性で作り直しました。実行例:

```bash
node scripts/generate-lora-previews.mjs --run --family krea2 --prompt '1girl, swimsuit, {trigger}, an adult woman in her twenties wearing a swimsuit, standing on a sunny sandy beach, blue sea and gentle ocean waves in the background, summer daylight, clear face, full body, detailed illustration, no text'
```

`{trigger}` に各LoRAの実トリガーが入ります。生成時に返る使用LoRAのIDと投入内容を照合しています。H3は新しい動画の先頭フレームをサムネイルにします。この1条件での生成成功は、全条件での品質や人物再現性を保証するものではありません。
