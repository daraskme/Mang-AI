# GLM-5.3 Flash / カスタムStrata（初期導入の記録）

> 現行構成は[2026-10-09 / Gen5・262K検証](glm-validation-2026-10-09.md)。以下のGen1・128K・privateという記述は当時の履歴であり、現在は両リポジトリを公開しています。通常のcoderもGLMへ移行済みです。

2026-10-09追加：brokerでの継続保持、思考budgetの設定化、3段階expert配置の観測は
[GLMコーディングの継続利用](glm-coding-session.md)を参照。以下の2026-10-08測定値は当時の設定の記録。

2026-10-08。利用者の再導入・private管理の指示に従い、
[daraskme/Strata-GLM](https://github.com/daraskme/Strata-GLM) を作成し、GitHubの`PRIVATE`を確認。
公開GLM派生 [Project Maya](https://github.com/mw00/project-maya) の
`5932f601373f53fc021f75dc55159a722c772571`を基に改良した。元のMIT表示と履歴を維持する。

## 配置と使い方

- ソース：`upstream/Strata-GLM/`。独立したprivate Gitリポジトリ。
- エンジン：同ディレクトリの`build/strata`。Pythonは`.venv/bin/python`。
- モデル：`models/llm/glm-5.3-flash-orcarouter/Q4_K_M/`。
- pack：モデルディレクトリ直下の`pack-maya-q4/`。
- API：`http://127.0.0.1:1243/v1`、モデルID `glm-5.3-flash-orcarouter-q4-mangai`。
- 専用のチャット画面：起動中の`http://127.0.0.1:1243/`。

```bash
nix develop /etc/nixos#cuda -c /mnt/solidigm-b/Mang-AI/upstream/Strata-GLM/.venv/bin/python /mnt/solidigm-b/Mang-AI/upstream/Strata-GLM/tools/run_glm.py --pack /mnt/solidigm-b/Mang-AI/models/llm/glm-5.3-flash-orcarouter/Q4_K_M/pack-maya-q4 --context 131072 --vram-cap-gib 90 --ram-headroom-gib 12 --prefill-mb 8192 --prefill-chunk 16384 --cpu-threads 8 --cpu-spin-us 1000 --cpu-affinity 0-15 --uniform-expert-slots --mangai-root /mnt/solidigm-b/Mang-AI --run
```

GPU・大容量RAMを使用する。`--run`を外すと事前確認のみ。
A1を先に起動する。空きRAM94 GiB・VRAM80 GiB未満なら起動せず、他のアプリやVMは停止しない。
Mang-AIの共通GPUキューを占有し、Ctrl+CでGLMを終了すると制作モデルへGPUを渡せる。
既存Qwen用Strataと通常のcoder設定は保持する。GLMを使うクライアントには上記API/モデルIDを指定する。
GLMの最大入力枠は131,072 tokensで、出力用の余白もこの枠に含まれる。
CPU指定はこのPCのi9-12900KS向け。別のCPUで同じaffinityを流用しない。
このpackにはコード課題から得たexpert使用頻度を配置済みで、通常運用の履歴は次回起動へ反映する。

## 実装した修正

現行OrcaRouter Q4_K_Mのgate/up expertはQ4_K、downはQ4_K/Q6_Kの混合。
元Mayaのdecode dispatchでは未対応だったQ4_K/Q5_K/Q6_Kの処理と起動前検査、未対応型の停止処理を追加した。
新モデルの混合形式を含むGPU数値比較9ケースと未対応型の拒否を確認済み。
CPUワーカーの同期負荷を減らし、12万バッチの取りこぼし・二重実行検査とThreadSanitizerを通した。

APIはGLMの`pre=glm4`を読み込み、`<arg_key>`/`<arg_value>`形式をtool_callsへ変換する。
日本語のトークン分割、分割送信、JSON型、既存Qwen構文の4回帰テストが合格。
GLMのツール引数は閉じタグ到着時に一括送信。強制`tool_choice`指定は未対応で、通常のauto選択を使う。

Nixの`NIX_ENFORCE_NO_NATIVE`により`-march=native`が除去されることを確認し、
AVX/AVX2/FMA/F16C/BMI2/AVX-VNNIを明示した。このPCのCPU expert小規模比較では
16 threadsの平均1.321 msから0.341 msへ短縮。これはモデル全体の速度ではない。
再現ビルド手順はprivateリポジトリの`README.MangAI.md`を参照する。

## モデル・メモリ

`orcarouter/GLM-5.3-Flash-Uncensored-GGUF` revision `efa699effe7e3114ac89a87bab2ee9f56ccddba3`、
5ファイル合計192,974,979,872 bytes。固定SHA256はprivate側の`configs/orcarouter-q4-model.json`。
取得には`tools/fetch_glm.py`を使い、完了時に`models/llm/glm-5.3-flash-orcarouter/verified-model.json`へ照合記録を保存する。
モデル自体はGitへ入れない。本体expertは169.91 GiBで、旧UD-IQ4_XSより約36 GiB大きい。
配布カードと異なり実GGUFにはMTP tensorが29個あるが、単一GPU用の実行経路がないため無効。A1は常駐を維持する。
RAM/VRAMに同じexpert全体を二重保存せず、GPU・RAM・SSDの層に分ける。
GPU上限には既に動いているA1等の使用量も含め、さらに2 GiBを予約。上の起動例ではRAMに12 GiBの余裕を残す。
空き容量に応じてRAM tierを決め、収まらないexpertはSSDから読む。
空きRAM8 GiB未満、空きVRAM1 GiB未満、A1 healthの連続失敗で所有するGLMプロセスを終了する。

## 追加最適化

Devin CLIでClaude Opus 5.5 Highへ、承認済みの限定したソース抜粋と測定値を送り、提案を取得した。
[提案全文](https://github.com/daraskme/Strata-GLM/blob/codex/glm-blackwell-q4/docs/opus55-optimization-consultation.md)と
[OrcaRouter版の測定記録](https://github.com/daraskme/Strata-GLM/blob/codex/glm-blackwell-q4/docs/optimization-round2.md)はprivate側に保存する。
CPU配置・長文chunk・expert使用頻度に応じたVRAM配分を比較できる。
benchmarkでは元の使用頻度をコピーし、各試験の履歴が次の比較条件を変えないようにする。

現行Q4の基準測定は768-token生成で8.7 / 9.7 / 9.9 tokens/s。
コード課題由来の使用頻度とPコア8 workersを使う起動例では19.9 / 22.8 / 24.3 tokens/sだった。
別のJSONL集計コード課題では18.0 / 18.6 tokens/s。いずれもprefix再利用0。
CPU12・16 workersも比較したが、その小さい差の優劣は断定しない。
これらは生成速度の測定で、長い生成コードの正しさを実行検証したものではない。
日本語指定文、clamp関数の8入力、tool JSONは別のsmoke試験で確認する。

32K検索は16K chunkで3箇所とも正答し、入力処理が217.34秒から130.26秒へ短縮。
24 tokens/s前後は短いコード入力での結果であり、長文入力の読み込み時間や全題材の速度を表さない。

最終構成の128K検索も合格。127,990 tokensの実入力から10%・50%・90%位置の
3つの合言葉をすべて正しく取り出した。入力処理553.38秒（約9分13秒）、
回答42 tokensの生成4.93秒（8.5 tokens/s）、API全体558.65秒、prefix再利用0。
262K以上の実入力と、長文コーディング全般の品質はこの試験では保証していない。

128Kの後も日本語・clamp・tool JSONは合格。4回の起動を合計268回監視しA1 health失敗0。
最終起動の空きRAM最小8.98 GiB・VRAM最小6.65 GiB。検証後はGLMを終了し、
空きRAM約110.79 GiB・VRAM約85.17 GiBへ戻り、A1は同じPIDで常駐を継続した。
詳細な全試行はprivate側の`docs/benchmarks-orcarouter-q4.json`へ保存している。

## 旧Unsloth UD-IQ4_XSでの検証記録

以下は旧checkpointの結果であり、現在のOrcaRouter Q4_K_Mの速度ではない。
旧モデルrevisionは`a38483c8cd5df544f53d70fb281afe97369d5ab6`、5ファイル合計156,822,111,200 bytes。

初回のCPU最適化前でも、日本語の指定文、clamp関数の8入力、ツールJSONが合格。
31,989 tokensと63,999 tokensの実入力で、10%・50%・90%位置の合言葉をすべて正しく検索した。
キャッシュ再利用は0。長文コーディング全般を保証する試験ではない。
CPU最適化後、context 131,072・A1常駐の最終設定でも短文3試験はすべて合格。

| 試験 | 入力 / 出力tokens | 生成速度（decode） | API全体の所要時間 | 判定 |
| --- | ---: | ---: | ---: | --- |
| 日本語の指定文 | 37 / 10 | 18.7 tokens/s | 3.22秒 | 一致 |
| clamp関数 | 73 / 37 | 16.7 tokens/s | 6.65秒 | 8入力で一致 |
| ツールJSON | 197 / 21 | 10.6 tokens/s | 17.71秒 | 名前・引数一致 |
| 128K長文検索 | 127,990 / 42 | 17.5 tokens/s | 612.38秒 | 3箇所すべて一致 |

この短文試験は`20261008T073400-smoke`。最適化前の生成速度は5.3～6.7 tokens/sだった。
最終設定の長文試験は`20261008T073454-needle`。127,990 tokensの実入力で3箇所すべて一致。
入力処理609.63秒（209.9 tokens/s）、生成2.40秒。入力処理と生成は別区間で、
上表の生成速度はAPI全体の速度ではない。追加した768-token×3回の持続生成では
12.0 / 12.4 / 12.0 tokens/s（中央値12.0）だった。3回の出力本文は同一で、キャッシュ再利用0。

最終起動の78回の監視でA1 health失敗0、空きRAMの最小31.97 GiB、空きVRAMの最小6.41 GiB。
GLMは検証後に正常終了し、共通GPUキューを解放。A1は起動前後で同じPIDのまま正常応答した。
終了後は空きRAM約108.83 GiB、空きVRAM約84.84 GiBへ戻った。

生ログは`upstream/Strata-GLM/build/runtime/`、入力・出力・token数・速度は
`upstream/Strata-GLM/build/validation/`。64Kの初回試験には並行ビルドと短いCPU比較があり、
その速度を最終構成の値と混同しない。

## PCIeの制約

GPU・CPU側root portはGen5対応だが、推論中も両端のsysfsが **2.5 GT/s / x16（Gen1）** を示した。
GPU温度43℃、電力約130～190W、600W上限、AERは0で、RAMからの転送を制限している可能性が高い。
PowerMizerの最大性能hintを同一NVML接続内で設定・読み戻ししても、短時間の比較ではGen1のままだった。
hintは元の0へ復元した。BIOS変更、リンク再訓練、GPUリセット、ドライバー交換は行っていない。

さらに調べる場合は管理者が`lspci -s 00:01.0 -vv`と`lspci -s 01:00.0 -vv`の
`LnkCtl2`/`LnkSta2`を確認する。本セッションの`sudo -n`はパスワード必須で詳細を取得できなかった。
パスワードをチャットへ貼らない。投稿の22.2 tokens/sは別ハードウェア・IQ1量子化の表示であり、
このQ4構成の実測値として扱わない。


## Gen5復帰後の比較用オプション

`tools/run_glm.py --cpu-plan 012234556`で、RAMに存在する非VRAM expert数0〜8に対する
CPU担当数を固定できる。省略時は従来の起動時校正を使う。SSD missはこの桁数の対象に含めない。
`--prefetch-experts 0..2`はRAMからVRAMへの先行コピー、`--lookahead-layers 0..4`は
SSDからRAMへの先行読み込み。両方とも既定0。先読みが増えるほど速くなるとは限らない。

Mang-AI登録スクリプト`manga-studio/scripts/configure-glm-coder.py`も`--cpu-plan`と
`--lookahead-layers`を受け付ける。まず`--apply`なしで確認できる。これらを省略して再登録すると
自動CPU分担・先読みなしへ戻る。登録はA1・他モデルを維持し、サービスを自動再起動しない。
検証は`python -m unittest discover -s manga-studio/tests -p test_glm_config.py`。
固定RAM95 GiBは比較条件であり、通常運用の可変RAM予算を置き換える既定値ではない。


このPCのGen5検証後の登録は`python manga-studio/scripts/configure-glm-coder.py --context 262144 --apply`。
262144指定時はRAM headroom16 GiBを設定し、空き容量に合わせてexpert RAM予算を決める。
これはOSの空きRAMが常時16 GiBになる保証ではなく、ロード後も監視する。通常の先読みは0、CPU分担はauto。
131072へ戻す場合は同じスクリプトに`--context 131072 --apply`を渡す。サービス反映は稼働中の仕事がない状態で行う。

共通broker経由の機能検査では、`tools/bench_glm.py --url http://127.0.0.1:1234 --model glm-5.3-flash-orcarouter-q4-mangai --pack <packの絶対パス> --case smoke`を使える。
返されたtoolは実行しない。コードは限定されたclamp関数のASTを検査して8入力で評価する。
