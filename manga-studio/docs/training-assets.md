# 学習データのAVIF化とモデル・LoRAの復元

静止画はAVIF対応のPillowで読み込み、LoRAは元の重みをそのまま保存します。キャプション生成では、AVIFを送信時だけPNGへ変換してllama.cppの画像入力へ渡します。ブラウザへの画像配信と学習用コピーはAVIFのままです。

## 保存先と公開範囲

| 対象 | 保存・復元方法 |
|---|---|
| 作成済みLoRA、途中チェックポイント、学習状態 | 所有者の非公開HFモデルリポジトリ。SHA-256単位で重複をまとめる |
| 圧縮後の画像、対応する.txt、動画、補足ファイル | 所有者の非公開HFデータセットリポジトリ |
| Krea2/H3の基本モデル | [版固定一覧](../../integrations/base-model-lock.json)から公開配布元へアクセス |
| 原画像 | ローカルの元フォルダに保持。自動削除しない |

個人用HF保存先の既定は `darask0/Mang-AI-LoRA-library` と `darask0/Mang-AI-training-datasets` です。所有者以外は取得できません。別のアカウントでは `--repo` で変更してください。私的なファイル一覧、トリガー、キャプション、認証情報はこのGitリポジトリへ含めません。

元データセットが存在しない登録は保管対象から除外し、非公開manifestに理由を残します。残っているLoRAは別に保存します。バックアップが `complete` でも、失われた元データの復元を意味しません。

## AVIFの変換条件

- quality 95、4:4:4、encoder speed 6。非可逆圧縮です。
- **長辺が2048を超える静止画だけ縮小**。縦横比を保持し、2048以下は拡大しません。
- EXIFの向きを画像へ反映。透過を保持し、完全に不透明なアルファ平面の省略は許容します。
- 元の拡張子をファイル名に残します。`sample.jpg` → `sample.jpg.avif`、対応するキャプションは `sample.jpg.txt`。同じstemのPNG/JPEG同士でも衝突しません。
- 複数フレームの画像は原本のまま別に保存し、静止画学習へ自動投入しません。動画の再エンコードはしません。
- 再実行時は原本・出力のSHA-256を照合して再利用し、キャプションの変更を反映します。変換失敗は `errors.jsonl` に記録し、完了扱いにしません。

```bash
caption-studio/runtime/python-run manga-studio/scripts/optimize-training-images.py \
  --source /absolute/path/to/original-datasets \
  --output /absolute/path/to/separate-avif-output \
  --max-edge 2048 --quality 95 --speed 6 --workers 12
```

入力と出力は入れ子にしないでください。出力の `images/` をCaption Studioで開けます。バックアップからの通常復元先は `datasets-optimized/`、アニメーションは `datasets-archive/`、元のZIP・補足資料は `datasets-supplemental/` です。

AVIF対応のPillowビルドが必要です。確認環境はPillow 12.3.0です。[Pillowの仕様](https://pillow.readthedocs.io/en/stable/handbook/image-file-formats.html#avif)ではAVIFを8-bit RGB/RGBAとして読み書きします。高ビット深度の原本を完全保存する形式としては使いません。既に圧縮済みの小さなJPEG/WebPでは容量が増えることもあります。

## 非公開バックアップから復元

Pythonと `huggingface_hub`、保存先を読めるHFログインが必要です。トークンをコマンドやREADMEへ直接書かないでください。標準の認証キャッシュは `~/.cache/huggingface`、別の場所は `--hf-home` で指定します。

バックアップ完了時に記録した40桁のコミットSHAを指定します。`--list` は対象数と容量だけを表示し、画像・重みを取得しません。

```bash
caption-studio/runtime/python-run manga-studio/scripts/restore-training-assets.py \
  --asset loras --revision YOUR_40_CHARACTER_COMMIT_SHA \
  --destination /absolute/path/to/Mang-AI --list

caption-studio/runtime/python-run manga-studio/scripts/restore-training-assets.py \
  --asset loras --revision YOUR_40_CHARACTER_COMMIT_SHA \
  --destination /absolute/path/to/Mang-AI --register

caption-studio/runtime/python-run manga-studio/scripts/restore-training-assets.py \
  --asset datasets --revision YOUR_DATASET_COMMIT_SHA \
  --destination /absolute/path/to/Mang-AI --register
```

`--family krea2` / `--family h3` で絞れます。LoRAの既定は登録済みの完成ファイルのみ。`--checkpoints` を付けると途中保存・学習設定も復元します。`.pt` はバイト列として保存・復元するだけで、自動ロードしません。旧学習設定に残る絶対パスは、学習を再開する環境で合わせる必要があります。

全ファイルのサイズとSHA-256を照合し、内容の異なる既存ファイルは上書きせず停止します。`--register` は存在確認できた項目を `models/training-library.json` へ登録し、更新前の一覧を `work/asset-restore-backups/` に保持します。

## 基本モデルの再導入

取得元のコミットを固定しています。Krea2は利用者自身が公式ページでアクセスを取得してください。スクリプトは利用条件への同意やアクセス制限の回避を代行しません。[Krea2](https://huggingface.co/krea/Krea-2-Raw)と[MiniMax H3のライセンス](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE)が引き続き適用されます。この一覧は重みの独自公開ミラーではありません。

```bash
# グループと必要容量を表示。ダウンロードしない
python3 manga-studio/scripts/restore-base-models.py

# Krea2推論部品と学習用RAW・VAE・text encoderを導入
python3 manga-studio/scripts/restore-base-models.py \
  --group krea2-inference --group krea2-training

# H3用の部品を導入
python3 manga-studio/scripts/restore-base-models.py \
  --group h3-native --group h3-comfy --group h3-turbo --group h3-upscaler
```

`--destination` で別の導入先を選択、`--verify-local` で重みのハッシュを読取検証できます。確認済みの重みは再取得しません。HFキャッシュとコピー先の空き容量を確保してください。現在の固定版はKrea2推論33.23 GiB、学習32.98 GiB、H3 native134.16 GiB、Comfy部品20.02 GiB、Turbo LoRA3.64 GiB、upscaler0.64 GiBです。Civitaiの追加モデルやローカル変換済みH3はこの一覧に含みません。既存の[取得・変換手順](../../integrations/README.md)を使います。

## 検証範囲と再学習時の注意

- AVIFの列挙、.txt読込、HTTP配信、PNGとしての推論API送信、学習用コピー、Musubiの列挙・RGBデコードを統合試験で確認。
- 2048上限、小画像の寸法維持、キャプション衝突防止、透過、変換再開、復元時のハッシュ不一致・既存編集の保護を試験。
- 画像を再圧縮した後はlatent/text encoderキャッシュを再生成。元と同じ学習結果になる保証はありません。
- 今回の確認で実モデルのキャプション品質評価やLoRA再学習は実行していません。H3の新規学習GUIは引き続き未実装で、H3動画は原本のまま保管します。
- ソース変更を既に起動中のCaption Studioへ反映するには、実行中の生成・学習が終わってから再起動してください。

```bash
MANGAI_CAPTION_PYTHON=/absolute/path/to/caption-studio/runtime/python-run \
  node --test integrations/caption-studio/tests/*.test.mjs
caption-studio/runtime/python-run -m unittest discover \
  -s manga-studio/tests -p test_training_assets.py
```

## 実施結果（2026-10-09）

静止画8,048枚をAVIFに変換し、アニメーション10件を原形式で保持しました。画像群は17.3953 GiBから3.9617 GiBへ77.23%削減。2,492枚を縮小し、5,556枚は寸法を維持、変換エラーは0件です。動画は再圧縮していません。原本も保持しています。

32個の登録済みLoRAを含む学習資産26.306 GiBと、画像・文章・動画・補助資料6.8601 GiBを、それぞれ指定された非公開Hugging Faceリポジトリへ保存しました。サイズとSHA-256を照合し、LoRA1個を実ダウンロードして一致を確認。データセットは16,308ファイルをローカルへ復元・検証し、登録先を最適化済みコピーへ切り替えました。個人用の固定コミットと復元コマンドは `work/hf-backup/RESTORE.md` に保存しています。

サムネイル設定と画像収集は [サムネイル手順](model-thumbnails.md)・[収集手順](dataset-collection.md) を参照してください。
