# A1常駐とGLMコーディングの継続利用

2026-10-09。A1が指揮し、GLM-5.3-Flash Orca Q4がコード作成・修正を担当する。
GLMはリクエストごとに終了せず、最後の応答から既定600秒保持する。
別のGPU工程が待機したら、現在の生成完了後、またはidle中に解放する。
保持中もクライアントはmessages/tool結果を送る。異なるモデル間でKVを共有しない。

最新の測定値・残る制約は[2026-10-09検証](glm-validation-2026-10-09.md)。以下のCPU affinity `0-15`は検証したi9-12900KS専用です。他のCPUでは設定スクリプトのコマンドを修正してください。

## 設定

既存のモデル・packを確認し、A1や他のモデル定義を保ったままGLMを登録する。
登録スクリプトの既定はcontext 131072。Gen5復帰後の実入力260090 tokensで3位置検索に成功し、prefill426.49秒・512 tokens生成17.1 tokens/sを確認したため、このPCでは`--context 262144`で登録する。262144ではRAM headroom16 GiBを使う。50 tokens/sと元FP8同等品質は未達／未検証。短文・長文の速度と品質は別々に評価する。

```bash
upstream/Strata-GLM/.venv/bin/python manga-studio/scripts/configure-glm-coder.py --context 262144
upstream/Strata-GLM/.venv/bin/python manga-studio/scripts/configure-glm-coder.py --context 262144 --apply
```

最初は事前確認、2行目はバックアップ付き設定反映。サービスの再起動やモデルの起動は行わない。
既存brokerの重い仕事が停止していることを確認後、`mang-ai-models.service`を再起動する。
A1のサービスを再起動する必要はない。GUIの起動時設定には`local.patch.yml`を使う。
起動中のGUIで旧coderが表示される場合は、その作業の区切りでGUIの設定を再読み込みする。

brokerはport1234、実GLMはport1243、model IDは`glm-5.3-flash-orcarouter-q4-mangai`。
モデル管理がGPU leaseを取得し、GLM launcherへロック済みdescriptorを継承する。
`--external-gpu-lease`はこの経路専用で、descriptorがなければ起動を拒否する。
standaloneで`--mangai-root`を指定した場合は、従来通りlauncher自身がleaseを取る。

## 思考と保持期間

`--thinking-budget 0`を既定とし、人工的な256-token打切りを外した。
これは思考を無効にする設定ではない。出力は各リクエストの`max_tokens`とcontext枠に収まる。
以前の短文smokeの再現には明示的に`--thinking-budget 256`を使う。
制限を変えた結果を同じ品質条件・同じ所要時間として比較しない。

保持時間はbrokerの`keepAliveSeconds`、または設定スクリプトの`--keep-alive`で0〜3600秒。
0なら応答ごとに解放。連続リクエストは同じプロセスを使い、重い生成は直列化する。
A1はこの排他に入らない。HTTPの`X-MangAI-Session`を指定すると保存応答と状態にsession IDが付く。
未指定のOpenAI互換クライアントでもモデル保持を使えるが、セッション所有権の識別は行わない。

`GET /models/status`でready/busy/starting/stoppedとモデルPIDを確認できる。
`POST /v1/models/unload`へ`{"model":"glm-5.3-flash-orcarouter-q4-mangai"}`を送るとidle中のモデルを解放する。
生成中は409。session headerを付けた解放では最後の利用セッションとの一致も確認する。
会話・応答は`work/gpu/responses/`に保存する。APIはlocalhostのサーバー間利用に限る。

## VRAM → RAM → SSDの配置

共通のdense等はGPU、expertは起動時の使用履歴順にVRAM、次にRAMへ置き、残りをSSD参照にする。
RAMには最近使ったexpertを保護するLFU方式があり、GPUとの重複コピーを解消する処理もある。
CPU laneで実行されたRAM expertは、その実行だけではGPUへ昇格しない。
GPU転送経路では空きslotへ昇格する。CPU/GPU分担は起動時に校正されるため、PCIeが遅いと
RAM上でCPU計算する比率が高まり、hot expertのGPU移動も進みにくい。

launcherに`--trace-experts`を指定すると`build/runtime/*-routes.0`へ実選択を記録する。
broker経由では設定スクリプトに`--trace-experts --apply`を付けて測定用の起動設定を作れる。
測定後、同じ設定値で`--trace-experts`を外して再反映し、idle時にbrokerを再起動する。
その際のCPU処理をGPU hitと混同せず、次の4区分で集計する。

```bash
.venv/bin/python tools/analyze_glm_tiers.py build/runtime/RUN-routes.0 --output build/runtime/RUN-tiers.json
```

- `vram_hit`：選択時点でVRAMにある。
- `ram_cpu`：RAMにあるexpertをCPUで計算する。
- `ram_to_gpu`：RAMからGPUへ転送する。
- `ssd_miss`：選択時点の表ではVRAM/RAMにない。先読みやOS page cacheが満たす場合もあり、物理SSD読み込み回数とは異なる。

`--ram-policy protected-lfu|lfu|lru`、`--ram-protect-tokens 64`で比較可能。
既定は従来のprotected LFU。traceは大きくなるので測定時だけ使う。
終了シグナルでログ末尾が切れた場合、解析の`--allow-truncated-tail`は改行のない最終行を除外して報告する。
未flushの行も失われ得るため、得られる比率は保存済み完全行の標本とし、生成全体の厳密なhit率としない。
これは観測・比較用の追加で、routingの選択やexpertの計算を省略する変更ではない。

## 検査

```bash
upstream/Strata-GLM/.venv/bin/python manga-studio/tests/test_model_broker.py
upstream/Strata-GLM/.venv/bin/python manga-studio/tests/test_glm_config.py
upstream/Strata-GLM/.venv/bin/python -m unittest discover -s upstream/Strata-GLM/tests -p test_glm_launcher.py
upstream/Strata-GLM/.venv/bin/python -m unittest discover -s upstream/Strata-GLM/tests -p test_glm_tiers.py
```

模擬HTTP試験では再利用、応答保存、idle解放、待機GPU工程への移譲、通信切断、異常終了、再起動、
residentとの並行利用を確認する。これだけで実モデルの262K・50 tokens/s・品質達成とはしない。
