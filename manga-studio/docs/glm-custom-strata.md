# GLM-5.3 Flash / カスタムStrata

2026-10-08。利用者の再導入・private管理の指示に従い、
[daraskme/Strata-GLM](https://github.com/daraskme/Strata-GLM) を作成し、GitHubの`PRIVATE`を確認。
公開GLM派生 [Project Maya](https://github.com/mw00/project-maya) の
`5932f601373f53fc021f75dc55159a722c772571`を基に改良した。元のMIT表示と履歴を維持する。

## 配置と使い方

- ソース：`upstream/Strata-GLM/`。独立したprivate Gitリポジトリ。
- エンジン：同ディレクトリの`build/strata`。Pythonは`.venv/bin/python`。
- モデル：`models/llm/glm-5.3-flash-validation/UD-IQ4_XS/`。
- pack：モデルディレクトリ直下の`pack-maya-iq4/`。
- API：`http://127.0.0.1:1243/v1`、モデルID `glm-5.3-flash-iq4-mangai`。
- 専用のチャット画面：起動中の`http://127.0.0.1:1243/`。

```bash
nix develop /etc/nixos#cuda -c /mnt/solidigm-b/Mang-AI/upstream/Strata-GLM/.venv/bin/python /mnt/solidigm-b/Mang-AI/upstream/Strata-GLM/tools/run_glm.py --pack /mnt/solidigm-b/Mang-AI/models/llm/glm-5.3-flash-validation/UD-IQ4_XS/pack-maya-iq4 --context 131072 --vram-cap-gib 90 --mangai-root /mnt/solidigm-b/Mang-AI --run
```

GPU・大容量RAMを使用する。`--run`を外すと事前確認のみ。
A1を先に起動する。空きRAM94 GiB・VRAM80 GiB未満なら起動せず、他のアプリやVMは停止しない。
Mang-AIの共通GPUキューを占有し、Ctrl+CでGLMを終了すると制作モデルへGPUを渡せる。
既存Qwen用Strataと通常のcoder設定は保持する。GLMを使うクライアントには上記API/モデルIDを指定する。
GLMの最大入力枠は131,072 tokensで、出力用の余白もこの枠に含まれる。

## 実装した修正

Unsloth UD-IQ4_XSの本体にはIQ3_S・IQ4_XS・Q6_Kのexpertが混在する。
元Mayaのdecode dispatchではQ6_Kが未対応だったため、Q4_K/Q5_K/Q6_K対応と起動前検査、未対応型の停止処理を追加した。
GPUの数値比較8ケースと未対応型の拒否を確認済み。

APIはGLMの`pre=glm4`を読み込み、`<arg_key>`/`<arg_value>`形式をtool_callsへ変換する。
日本語のトークン分割、分割送信、JSON型、既存Qwen構文の4回帰テストが合格。
GLMのツール引数は閉じタグ到着時に一括送信。強制`tool_choice`指定は未対応で、通常のauto選択を使う。

Nixの`NIX_ENFORCE_NO_NATIVE`により`-march=native`が除去されることを確認し、
AVX/AVX2/FMA/F16C/BMI2/AVX-VNNIを明示した。このPCのCPU expert小規模比較では
16 threadsの平均1.321 msから0.341 msへ短縮。これはモデル全体の速度ではない。
再現ビルド手順はprivateリポジトリの`README.MangAI.md`を参照する。

## モデル・メモリ

`unsloth/GLM-5.3-Flash-GGUF` revision `a38483c8cd5df544f53d70fb281afe97369d5ab6`、
5ファイル合計156,822,111,200 bytesを再取得しSHA256を照合。
照合記録は`models/llm/glm-5.3-flash-validation/verified-model.json`。モデル自体はGitへ入れない。
MTPは単一GPU用の実行経路がないため無効。A1は常駐を維持する。
RAM/VRAMに同じexpert全体を二重保存せず、GPU・RAM・SSDの層に分ける。
GPU上限には既に動いているA1等の使用量も含め、さらに2 GiBを予約。RAMは20 GiBの余裕を残す。
空きRAM8 GiB未満、空きVRAM1 GiB未満、A1 healthの連続失敗で所有するGLMプロセスを終了する。

## 検証記録

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
上表の生成速度はAPI全体の速度ではない。短い回答を測った値であり、長時間の生成速度は未測定。

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
