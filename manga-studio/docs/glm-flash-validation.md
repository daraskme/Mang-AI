# GLM-5.3 Flashの実機検証記録（終了）

追記：その後の「GLM対応のカスタムStrataを作って。リポジトリはprivateで」という新しい依頼による再導入は、[カスタムStrataの記録](glm-custom-strata.md) に保存する。この文書は旧llama.cpp試験当時の結果である。

2026-10-08。利用者の検証指示を受け、IQ4_XSを取得して短文・コード・ツール呼び出しを実測した。その後の「GLMはけしてOK」に従い検証を終了し、約157GBのモデルと約0.5GBの専用エンジンを削除済み。常駐モデルには採用していない。以下の配置・再現手順は当時の記録であり、現在インストール済みという意味ではない。

## 実測結果と終了状況

5分割の重み156,822,111,200 bytesを固定リビジョンから取得し、全ファイルのSHA256を照合した。8,192 context、CPU expert指定26、F16キャッシュ、既定のmmap読み込みで起動まで93.08秒。

| 確認 | 入力tokens | 入力処理tokens/s | 出力tokens/s | 応答完了まで | 結果 |
|---|---:|---:|---:|---:|---|
| 日本語の短文 | 35 | 3.31 | 5.63 | 12.35秒 | 指定文と一致 |
| Python clamp関数 | 89 | 4.65 | 6.68 | 29.19秒 | 機能7ケース合格、型注釈を付けない指定は不遵守 |
| 構造化ツール呼び出し | 185 | 5.54 | 8.87 | 35.84秒 | ツール名・JSON引数が一致。外部操作はしていない |

すべて新規入力で、キャッシュ再利用は0。コードの生ログは型注釈を理由に不合格を記録している。保存済み回答を安全な構文に限定して別途再検査し、機能の7ケース合格と指示不遵守を分けて記録した。生ログは書き換えていない。

5,962 tokensの長文は入力処理が遅く、237.61秒時点で1,801 tokensまで進んだところで比較設定を検討するため中断。回答・長文検索精度は未検証。`--load-mode none`、32K・64K入力、Q8キャッシュの比較は実行せず、利用者の削除指示で終了した。総合合格とはしていない。

検証中の空きVRAM最小値は12.78GiB、プロセスRSS最大値は90.94GiB。RSSにはmmapされたファイルページを含み、専有RAM量とは異なる。検証プロセスの終了後は空きVRAM83.98GiBまで回復し、A1のhealth正常・PID不変を確認した。

生ログはローカルの `manga-studio/.test-output/glm-20261007T211653Z-5167f2/`、取得時ハッシュ記録は `work/glm-validation/verified-model.json` に保存する。モデル・専用エンジンの削除後は事前検査が未準備を返すのが正常。再取得・再起動は自動では行わない。

明示実行用の [live-glm-validation.py](../tests/live-glm-validation.py) は、事前検査・共通GPUキュー・A1監視・メモリ下限・終了処理付きの再現コードとして残す。`--run` なしでは推論しない。再検証を依頼された場合だけ、負荷を通知して環境を用意し直す。

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

2026-10-07の準備では固定版のGGUF先頭情報だけを取得し、1,412テンソルの形状・量子化型を読み取った。先頭の9.43MBファイルはメタデータのみで、これだけでは推論できない。

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

モデル取得は明示的な専用ロールだけで行う。`all`は従来どおりA1とQwenだけを対象とする。約157GBの通信とSSD書き込み、SHA256照合のCPU/SSD読み取りが発生する。huggingface_hubを導入したPythonが必要。5ファイルを同じ固定リビジョンで取得・照合し、`verified-model.json`を保存する。今回取得・照合した重みは検証終了後に削除済み。

```bash
python3 manga-studio/scripts/setup-agent-models.py glm-validation
```

取得・推論結果やモデルファイルはGitに入れない。ハッシュ記録の存在とサイズ確認は、検証直前の全量再ハッシュではない。破損を疑うときは取得処理を再実行して照合する。

## 2026-10-07の準備時点の確認

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
