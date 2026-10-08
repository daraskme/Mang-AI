# 制作環境のソース管理

ルートリポジトリでMang-AI本体と既存生成環境への変更を管理します。各生成環境の元のGit履歴は残し、ルートには固定コミットと差分を収録します。

| ファイル | 内容 |
|---|---|
| `manifest.json` | 取得元URL、固定コミット、パッチのSHA256 |
| `krea2.patch` | Krea 2 StudioのConvRot INT8読込など |
| `h3.patch` | H3のモデル登録、潜在Hires、メモリ設定など |
| `latent-upscaler.patch` | 長尺ノードと潜在アップスケーラの互換修正 |
| `base-model-lock.json` | 公開配布元の基本モデル・固定コミット・重みSHA-256 |
| `caption-studio/` | 既存キャプション・LoRA学習ツールのソース |

Krea/H3/Captionへの共通GPUキュー接続も上記差分に含みます。共有モジュールは`manga-studio/python/mangai_gpu.py`、長尺Comfy拡張は`manga-studio/integrations/comfy-gpu-lease/`にあります。[常駐モデルの導入記録](../manga-studio/docs/resident-model-setup.md) の設定スクリプトで接続します。Strataの固定リビジョンも`manifest.json`に含めますが、CUDAエンジンとモデルは別途準備します。

GLM用のカスタムStrataは独立した公開リポジトリで管理し、固定版を[strata-glm.json](strata-glm.json)に記録します。通常の復元スクリプトはこの任意追加環境を取得しません。`https://github.com/daraskme/Strata-GLM.git`を`upstream/Strata-GLM/`へcloneし、記録したコミットをcheckoutしてから同リポジトリの`README.MangAI.md`に従ってビルドします。[起動・実機検証](../manga-studio/docs/glm-custom-strata.md)も参照してください。

```bash
python3 manga-studio/scripts/restore-integrations.py
```

復元スクリプトは存在しないディレクトリだけを取得し、既存チェックアウトを上書きしません。仮想環境、Node依存、GPUドライバー、重みの再導入は別途必要です。現在のPCでは導入済みです。各環境のREADMEと `manga-studio/README.md` を参照してください。

モデル、データセット、作品、会話、APIキー、仮想環境はGitの対象外です。Civitaiの認証情報は `secrets/models.env` にだけ保存します。Smite79 H3-LongVideos本体は再配布せず、`manga-studio/scripts/setup-longvideo.py` で指定リビジョンを配布元から取得します。第三者コードには配布元のライセンスが適用されます。

追加モデルの取得・登録は `manga-studio/scripts/download-selected-models.py`。KreaモデルはSHA256照合後に未登録IDだけ `config.local.toml` へ追加します。H3の単発用モデルは既存 `minimaxH3-darask/scripts/convert_singlefile_h3.py` でDiffusers形式へ変換します。長尺環境は元の単体ファイルを使います。

既存環境を変更した後は `python3 manga-studio/scripts/snapshot-integrations.py` でソース差分を更新し、差分を確認してコミットします。実行前に追加したファイルがソースであることを確認してください。

基本モデル・非公開LoRA・AVIFデータセットの復元は[保存・再導入手順](../manga-studio/docs/training-assets.md)を参照してください。
