# 常駐A1・Strata・共通GPUキューの導入記録

2026-10-06。GPUはRTX PRO 6000 Blackwell、RAM 128GB、VRAM 96GB。取得・変換と推論検証は区別する。現在の実機確認範囲は [構成と検証結果](local-agent-architecture.md) を参照。

## ソース・モデルの固定

`scripts/restore-integrations.py` は `../integrations/manifest.json` の固定ソースを、存在しないフォルダへ復元する。既存チェックアウトは変更しない。

| 対象 | リビジョン | ライセンス |
|---|---|---|
| NullpoLab/Agents-A1-4B-Heretic-ARA-Refusals8-GGUF | `53e7b782a1e8b1890593390185c5a79387448954` | 配布カードのApache-2.0 |
| orcarouter/Qwen3.8-Flash-Next-Uncensored-GGUF | `e43d00f4e2b8b40b89f75e9adeb1045ac34c8acc` | 配布カードのApache-2.0 |
| Niko1221/Strata | `6f32ec070f23ced9f50e704d854d775da52591ab` | MIT |
| Strataのllama.cpp | `3cf03257f219afbe7334045ff7c6a06ac68c627d` | MIT |
| Qwen/Qwen3.8-Flash-NextのMTP | `de4b8e4d43b917e7706784d8bb445c9af86a3540` | 配布カードのApache-2.0 |

モデルはGitに含めない。Hugging Faceへのログインは環境変数`HF_TOKEN`、`secrets/models.env`、既存のHFログインを利用する。キーをチャットやREADMEへ書かない。

```bash
# huggingface_hubを導入済みのPythonで実行。GPUは使わずSSDを約194GB使用する。
python3 manga-studio/scripts/setup-agent-models.py all
```

ダウンロードは再開可能。全ファイルを配布元のSHA256と照合し、`models/llm/*/verified-model.json`へ記録する。A1はQ8本体とBF16 projector、QwenはQ8全5分割。

## Strataのビルド・Q8 native pack

指定したQ8はStrata標準setupのモデル一覧にない。既存Q8をnative packとして使用する。Strataの固定版でPython 3.12の`.venv`とrequirements、CUDA 13依存を導入する。GPUドライバーとCUDAツールチェーンは環境に合わせる。このPCではNixOSの`/etc/nixos#cuda`を使用した。

事前ビルドの取得が404だったため、このPCでは次のコマンドでsm_120対応エンジンをビルドした。CPU・RAMを使うため実行前に通知する。

```bash
cd upstream/Strata
nix develop /etc/nixos#cuda -c .venv/bin/python -u -c 'import setup; setup.os.cpu_count=lambda:4; print(setup.build_engine(setup.gpus()[0],"none",True,setup.get_llama_cpp(),13))'
.venv/bin/python tools/iq_pack.py --gguf ../../models/llm/qwen-flash-next/Qwen3.8-Flash-Next-Uncensored-Q8_0-00001-of-00005.gguf --out ../../models/llm/qwen-flash-next/strata-pack --compat-bf16
```

NixOSでnumpy等の共有ライブラリーが見つからない場合は、そのシェルのlibstdc++・zlibとGPUドライバーのライブラリーパスを`LD_LIBRARY_PATH`に設定する。固定の`/nix/store`パスを配布設定へ埋め込まない。

この変換ではexpertとPLEのQ8バイト列を保持し、互換性のため483個の非expertテンソルをBF16へ変換した（96個は厳密、387個は丸めあり、約1.26GiB、最大絶対丸め誤差0.0144）。全テンソルが元Q8と同一という意味ではない。native packにより188GBのexpertコピーを別途作らない。

このStrata版のnative packサーバーにはMTPと`spec >= 2`が必要だった。`spec=0`を実動構成として扱わない。

```bash
# upstream/Strataで実行。fetchは通信、pack/rtはCPU・RAMを使用する。
.venv/bin/python tools/mtp_fetch.py fetch --out ../../models/llm/qwen-flash-next/mtp
.venv/bin/python tools/mtp_fetch.py verify --out ../../models/llm/qwen-flash-next/mtp
.venv/bin/python tools/mtp_pack.py --src ../../models/llm/qwen-flash-next/mtp --experts q2_0 --out ../../models/llm/qwen-flash-next/mtp/mtp-q2_0.gguf
.venv/bin/python tools/mtp_rt.py --gguf ../../models/llm/qwen-flash-next/mtp/mtp-q2_0.gguf --out ../../models/llm/qwen-flash-next/mtp/rt
.venv/bin/python -c 'import setup; from pathlib import Path; setup.refresh_draft_vocab(Path("../../models/llm/qwen-flash-next/mtp/rt"),"cjk")'
```

MTP取得元の固定リビジョンとハッシュ検証結果を確認する。upstreamの取得ツールが別リビジョンへフォールバックした場合は同じ検証済み構成と扱わない。MTPの2bitは投機デコード用のdraftであり、本体Q8を2bitへ変更するものではない。

## ローカルサービスへ接続

```bash
# リポジトリのルートで実行。llama.cppはqwen35とGemma対応版を指定する。
python3 manga-studio/scripts/configure-resident-models.py --llama-binary /path/to/llama-server --library-path /path/to/native/libraries --install
systemctl --user daemon-reload
cd manga-studio
npm start
```

`--install`はユーザーsystemdユニット、各生成サービスの環境変数、ComfyUIのGPU待機拡張、`studio.config.json`を作る。元ファイルは`.before-resident-models`へ一度バックアップする。スクリプト単体ではモデルを起動しない。既に稼働中の生成サービスはジョブが無いことを確かめて再起動する。

設定の実体はGit対象外の`work/runtime/`。A1は65,536 context、Q8 KV、約7.2GiB VRAM。Qwenの候補設定は262,144 context、INT8 KV、KV常駐32,768、RAM常駐予算64GiB、VRAM余裕8GiB、spec 4。これは設定値であり、262Kの全文推論に成功した記録ではない。

Qwen起動には**空きRAM 88GiB、VRAM 72GiB**を要求する。空きが足りなければGPUキューで待機し、別の小さな処理は進められる。仮想マシンの停止は利用者が行う。A1や他アプリを勝手に解放しない。

Gemma・Qwenは1回のAPI応答を保存してからプロセスを終了する。Qwenを使うコーディングの各ツール往復でも再ロードする現状のため、応答速度の実測と保持時間の調整は今後の実機試験が必要。

## 検証

通常の`npm test`は模擬APIを使い、モデルをロードしない。GPU排他・中止とComfyの失敗保持は次で確認する。

```bash
python3 -m unittest discover -s manga-studio/tests -p 'test_*gpu*.py'
python3 manga-studio/tests/test_model_broker.py
cd manga-studio
node_modules/.bin/node tests/models-browser.mjs
```

以下は実モデルを使う。**GPU・RAM負荷を利用者へ通知してから**実行する。制作データは`.test-output/resident-workflow-*/`に保存し、通常作品を上書きしない。

```bash
node_modules/.bin/node tests/live-a1.mjs
node_modules/.bin/node tests/live-resident-workflow.mjs plan
node_modules/.bin/node tests/live-resident-workflow.mjs render <planが返したrun-dir>
```

Krea/H3/長尺/キャプション/学習の共通GPUキューは、`MANGAI_GPU_STATE`を設定した管理サービスで有効。管理外から直接起動した別アプリまで排他制御する機能ではない。

旧Qwen 27Bを明示選択したセッションは、新しい既定値へ自動では切り替わらない。通常GUIのモデル選択でA1を選ぶか、`TEST_URL='<通常GUIのURL>' MIGRATE_LEGACY=1 node_modules/.bin/node tests/resident-ui.mjs`で旧モデルIDのセッションだけ移行できる。このコマンドは会話を送らず、モデル選択イベントを保存する。`MIGRATE_LEGACY`を省略すると読み取り検証だけを行う。
