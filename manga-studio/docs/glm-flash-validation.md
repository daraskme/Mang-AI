# GLM-5.3 Flashの実機検証準備

2026-10-07。利用者の「今は準備だけ進める」に従い、GLMのモデル読み込み・推論・速度測定・大容量重み取得は未実施。A1と制作環境の設定は変更しない。

## 対象と固定版

| 対象 | 固定内容 |
|---|---|
| PC | i9-12900KS、RAM 128GB（OS表示125GiB）、RTX PRO 6000 Blackwell 96GB |
| 検証用エンジン | llama.cpp v0.6.0 / `d81235049384534c167caea52b85a694f6103d14` |
| エンジン配置 | `upstream/llama.cpp-glm-validation/`。既存A1用0.4.1・Strataは保持 |
| モデル | `unsloth/GLM-5.3-Flash-GGUF`、UD-IQ4_XS |
| モデルリビジョン | `a38483c8cd5df544f53d70fb281afe97369d5ab6` |
| モデル保存先 | `models/llm/glm-5.3-flash-validation/UD-IQ4_XS/` |
| 配布容量 | 5分割、156,822,111,200 bytes（約146.052GiB） |
| 検証用API候補 | `127.0.0.1:1243`。常駐APIには登録していない |

Flashは320B・推論時18Bの`glm5_next`。744Bの通常GLM-5.3とは別モデル。現在のStrataは`qwen4exp`専用で、llama.cppの新しいモデル対応を自動では取り込まない。

## メモリ配置の見積もり

固定版のGGUF先頭情報だけを取得し、1,412テンソルの形状・量子化型を読み取った。重み全体はダウンロードしていない。先頭の9.43MBファイルはメタデータのみで、これだけでは推論できない。

取得した先頭部分は合計13,624,288 bytes、解析したヘッダー部分は9,518,887 bytes。GGUFの46層表記にはNextN層が含まれ、本体は45層。元の解析記録はローカルの `work/glm-validation/headers.json` に保存する。

MTPを使わない場合の主要重みの配置候補は次の通り。`--n-cpu-moe N`は先頭N層のexpertをCPUへ置く。先頭3層はdenseなので、26指定では23層のexpertが対象。

| n-cpu-moe | CPU expert重み | その他の重み（主にGPU） |
|---:|---:|---:|
| 22 | 61.207GiB | 81.450GiB |
| 24 | 67.465GiB | 75.192GiB |
| **26（初回候補）** | **73.723GiB** | **68.935GiB** |
| 28 | 79.980GiB | 62.677GiB |

これはテンソルのバイト数による推定。NextN層の約3.386GiBは除外し、入力embeddingのCPU配置など細かい配置差、KV/recurrent cache、作業領域、転送時の一時領域、allocatorの余裕は含まない。実プロセスのRAM/VRAM使用量や、起動成功を保証する表ではない。

事前確認時は空きRAM約40GiB・空きVRAM約84GiB。初回の暫定条件は空きRAM88GiB・VRAM80GiB以上とし、A1の応答を維持する。VMは利用者が停止する。外部アプリや他の制作ジョブは終了しない。GPUキューを確保してから検証し、所有する検証プロセスだけを終了する。

準備中の再確認では空きRAM104.38GiB・VRAM83.83GiB、A1 healthは正常。空き容量の変化を推論開始の指示と解釈せず、「準備だけ」の範囲を維持した。

## 用意する設定と確認順序

読み取り専用の [glm-validation-plan.py](../tests/glm-validation-plan.py) が、固定コミット、ビルドファイル、重みのサイズ・取得時ハッシュ記録、空きRAM/VRAM、A1のhealth、検証ポートを確認し、起動コマンド候補を表示する。モデルを起動する経路は持たない。未準備なら終了コード2。

```bash
python3 manga-studio/tests/glm-validation-plan.py
```

初回候補は8,192 context、1 slot、batch 256／ubatch 128、CPU threads 8、F16キャッシュ、Flash Attention、CPU expert指定26、fit off、reasoning low、MTPなし。

1. GPU・大容量RAM負荷を利用者へ通知し、事前検査と共通GPUキューを通す。
2. モデル起動時の実配置・RAM/VRAMピーク・A1応答・エラーを記録する。
3. 短い日本語応答、簡単なコード生成、構造化ツール呼び出しを各1回確認する。思考のみで終了した場合も成功としない。
4. 8Kで成功した後、32K・64Kの実入力を与え、初回応答時間、prefill/decode速度、ピークメモリ、検索した情報の正確さを記録する。設定値を変えただけでは長文検証成功としない。
5. KキャッシュだけQ8にした場合と比較する。KDA recurrent stateはF32固定なので、キャッシュ全体が半分になるとは扱わない。
6. 実測に余裕があればCPU expert指定24や長いcontextを比較する。最適な量子化・context・速度は未決定。
7. 結果を保存し検証プロセスを終了、VRAM解放とA1の継続稼働を確認する。採用を決めるまで通常のcoder設定は置き換えない。

## エンジンとモデルの準備手順

このPCでは既存CUDA 13開発シェルを利用。ビルドはCPU/RAMを使うので通知し、並列数2に制限する。OSの再構築や既存エンジンの更新は不要。`/etc/nixos`はこのPC固有の開発シェル。

CPU expert計算用に、このi9で確認済みのAVX／AVX2／FMA／F16C／AVX-VNNIを有効にする。他CPUでは命令セットを再確認する。API検証ではWebUIを使わず、追加のUI取得を無効にする。

```bash
git clone --depth 1 --branch v0.6.0 https://github.com/ggml-org/llama.cpp.git upstream/llama.cpp-glm-validation
git -C upstream/llama.cpp-glm-validation rev-parse HEAD
nix develop /etc/nixos#cuda -c cmake -S upstream/llama.cpp-glm-validation -B upstream/llama.cpp-glm-validation/build -G Ninja -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=120 -DCMAKE_BUILD_TYPE=Release -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON -DGGML_AVX_VNNI=ON -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_APP=OFF -DLLAMA_OPENSSL=OFF -DLLAMA_BUILD_UI=OFF -DLLAMA_USE_PREBUILT_UI=OFF
nix develop /etc/nixos#cuda -c cmake --build upstream/llama.cpp-glm-validation/build --target llama-server llama-cli --parallel 2
```

モデル取得は明示的な専用ロールだけで行う。`all`は従来どおりA1とQwenだけを対象とする。約157GBの通信とSSD書き込み、SHA256照合のCPU/SSD読み取りが発生する。huggingface_hubを導入したPythonが必要。5ファイルを同じ固定リビジョンで取得・照合し、`verified-model.json`を保存する。今回この取得コマンドは実行していない。

```bash
python3 manga-studio/scripts/setup-agent-models.py glm-validation
```

取得・推論結果やモデルファイルはGitに入れない。ハッシュ記録の存在とサイズ確認は、検証直前の全量再ハッシュではない。破損を疑うときは取得処理を再実行して照合する。

## 今回の検証結果

- CUDA 13.0.88、sm_120a、GNU 15.3.0でserver／cliをビルド完了。上記CPU命令セットを有効にした差分ビルドも成功。
- `llama-server --version` は `0.6.0-dev (build 1, commit d812350)`。タグv0.6.0の固定コミットからビルドした際の表示。
- `--list-devices` でRTX PRO 6000 Blackwellを認識。`--help`で起動候補の全オプションを確認。いずれも終了コード0で、モデル未ロード。
- 事前検査は未取得の5ファイルを未準備として返す。実機推論の成功や速度として扱わない。
- `setup-agent-models.py all` の対象がA1／Qwenのままであることを確認。GLMは明示的な`glm-validation`のみ。
- リポジトリ監査14項目、構文・参照・差分の検査に合格。検証用エンジン、取得時ハッシュ記録、メモリ見積もりの存在だけではモデルの動作確認にならない。
- 通常のmodel broker・GPUキュー設定・A1サービスは変更していない。GitHubは非公開を維持。

## 既知の制約と一次資料

- [公式v0.6.0](https://github.com/ggml-org/llama.cpp/releases/tag/v0.6.0) でGLM5-Next対応を確認。モデル対応とこのPCでの動作成功は別。
- [公式GLM設定](https://huggingface.co/zai-org/GLM-5.3-Flash/blob/main/config.json)：45層、KDA／DSA混合、最大1,048,576 context。このPCで1Mを実用速度で扱える証明ではない。
- [固定版GGUF](https://huggingface.co/unsloth/GLM-5.3-Flash-GGUF/tree/a38483c8cd5df544f53d70fb281afe97369d5ab6/UD-IQ4_XS)：取得対象とSHA256は配布元APIで確認。
- [Blackwellの既知報告 #28282](https://github.com/ggml-org/llama.cpp/issues/28282)：9月2日の開発ブランチで大きなubatchによる不正アクセス、128／512で回避という報告。v0.6.0にも残るとは未確認。初回を128にする根拠として扱う。
- [公式GLM5-Next実装](https://github.com/ggml-org/llama.cpp/blob/v0.6.0/src/models/glm5-next.cpp)：NextN/MTP graphは未実装なので有効にしない。
- [公式メモリ実装](https://github.com/ggml-org/llama.cpp/blob/v0.6.0/src/llama-model.cpp)：K-only MLAとindexer cache、KDA recurrent F32。Vキャッシュの量子化で一律に節約できるモデルではない。
- [Flash専用Unslothガイド](https://unsloth.ai/docs/models/glm-5.3-flash)：開発ブランチの速度やMTPの測定値を、この固定版エンジンの実測値として転記しない。
