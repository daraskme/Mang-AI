# LoRA作成とモデル指定生成の実機確認（2026-10-08）

Krea2は、UNSEEN Gemmaによるキャプション→TXT保存→LoRA学習→登録→そのLoRAを使った画像生成まで今回再確認した。H3は既存LoRAを利用する生成経路があるが、新規LoRA学習はMang-AIに未統合で、現在のGUI・エージェントからは実行できない。

## Krea2の新規LoRA学習

既存の本番データを変更せず、テスト用花瓶画像3枚のコピーを使った。256px、1 step、rank/alpha 4、FP8、学習率8e-5。UNSEEN Gemmaで3枚ともキャプションを作成してTXT保存した後、Gemmaを解放してRAW DiTで学習した。

- 学習結果：`completed`、1/1 step、loss 0.0358。学習処理全体は約41.72秒。
- 最終LoRA：58,743,288 bytes、792テンソル。NaN/Infなし。
- ゼロ初期化されるB側（`lora_up.weight`）264/264テンソルが非ゼロに更新され、学習計算が実際に行われた。
- 登録先へのコピーはサイズとSHA256が一致。SHA256は `9c5b2190669a555b2e8849b2b8ada0f95230c9a97917e207211d5ee96850b04c`。
- 登録ID `migration-smoke-1791408548825.safetensors`、trigger `migration_vase`、強度0.8で公式Krea2 Turboから512×512 PNGを生成できた。

生成した絵は青い花瓶・黄色い花3本・木の机という指定に沿う。ただし1 stepは学習・保存・適用経路の動作確認であり、画風や人物を十分覚えたLoRAの品質を示すものではない。長時間・本番品質の学習は今回行っていない。

ローカルの証跡：

- `caption-studio/training-runs/2026-10-07T21-28-26-720Z-ca76a4/result.json`
- 同フォルダの `train.log`、`output/krea2_lora.safetensors`
- `manga-studio/.test-output/live-caption-1791408484031/`

## 指定したモデルとLoRAによる画像生成

GUI・エージェントと同じセッション別選択保存処理を使い、生成時にはモデル・LoRAを再指定せず、保存した選択が引き継がれることを確認した。比較条件は512×512、8 steps、seed 42。漫画用LoRAは `user/style/krea2_manga_style.safetensors`、強度0.6。

テスト内容は「木の机の左に赤いマグカップ1個、右に閉じた青い本1冊、クリーム色の壁、左からの採光。人物・文字なし」。モデルID、LoRA IDと強度、prompt、seed、PNG寸法、実際の生成中のロード状態、各生成passの記録を照合した。

| モデル | LoRA | 読込等を含む処理時間 | 推論時間 | PyTorch最大予約VRAM | 目視結果 |
|---|---|---:|---:|---:|---|
| Kroma v0.3 Turbo | なし | 17.19秒 | 1.71秒 | 34.11GiB | 色・数・左右・文字なしが一致 |
| Kroma v0.3 Turbo | 漫画用 0.6 | 14.52秒 | 1.76秒 | 34.24GiB | 同上 |
| MUSE v3.5 INT8 | 漫画用 0.6 | 12.46秒 | 1.89秒 | 23.28GiB | 同上 |
| Moody V8 INT8 | 漫画用 0.6 | 14.65秒 | 1.82秒 | 23.00GiB | 同上 |
| Redcraft 3.0 INT8 | 漫画用 0.6 | 12.47秒 | 1.83秒 | 22.71GiB | 同上 |
| 公式Krea2 Turbo | 漫画用 0.6 | 18.02秒 | 1.72秒 | 34.24GiB | 同上 |
| 公式Krea2 Turbo | 今回学習したLoRA 0.8 | 14.69秒 | 2.00秒 | 34.04GiB | 別プロンプトの青い花瓶・黄花3本と一致 |

各数値は1回の測定値。GPU全体の使用量ではなく、Kreaプロセスが記録したPyTorchの値。長いプロンプト、高解像度、多数のLoRA、学習品質の評価へ一般化しない。

KromaのLoRAなし画像を同条件で2回作るとRGB画素は完全一致した。漫画用LoRAを適用すると262,144画素中260,377画素が変化し、カップ・本の形や陰影にも目視差があった。メタデータだけの変更ではなく、画像にLoRAの効果が出ている。特定人物の再現、複数人物の動作、全24本の画風LoRA、指定の厳密な再現率は未評価。

テスト7ケースすべてでA1のhealth正常・PID不変。生成ごとにKreaがGPU重みを解放し、終了後もロード状態は空だった。最終GPU空き容量は約84.9GiB。

ローカル証跡は `manga-studio/.test-output/model-selection-1791408742338/`。`report.json` は機械検査、`visual-review.json` は目視と画素比較。各ケースの `*-selection.json`、`*-runtime.json`、`*-metadata.json`、`*-result.json` とPNGを保存した。最初の試験は画像生成に成功したが、完了後の自動アンロードを検査が考慮しておらず停止した。生成中にロード状態を確認するよう試験を修正して全ケースを実行し直した。

## H3で不足しているもの

[LocalStudios.prepareTraining](../src/local-studios.js) は `family:h3` を明示的に拒否し、誤ってKrea2の学習に流さない。旧H3学習データとai-toolkitソースを保存したことは、新しい環境から学習を開始できることとは別である。

旧 `archives/previous-training/H3/_tools/train_local.py` はWindowsのドライブ・Python・プロセス終了操作を前提にするため実行していない。隔離したLinux学習環境、学習用ベースとadapterの確認、現在のパス設定、開始・進捗・停止・LoRA登録のAPI、共通GPUキューとの接続、小規模の実学習試験が必要。生成用のPython環境を学習用として流用できるとは判定していない。

H3の既存LoRA生成経路は読み取り確認したが、今回はH3の動画生成・新規学習を実行していない。

## 再現と軽量検査

以下は `manga-studio/` を作業ディレクトリとする。実機テストはGPU/RAM負荷を利用者へ通知し、他の処理がアイドルのときに順番に実行する。学習試験はCaption Studioの表示データセットをテスト用へ切り替え、Kreaサービスを停止・再起動する。

```bash
node tests/live-studios.mjs caption
node tests/live-model-selection.mjs --run --trained-lora <今回登録したLoRAのID>
```

2本目は最初にKreaの重みが未ロードであることを要求する。学習済みLoRAの確認が不要なら `--trained-lora` を省略できる。通常の `npm test` から実モデルは起動しない。目視は自動合否に含めず、出力画像を別途確認する。

関連する軽量回帰12件と、モデル一覧GUIの選択・強度・用途・サムネイル・保存・再読込・モバイル表示を確認した。GUI試験は模擬カタログを使い、実画像生成は上記の実API試験で確認している。

```bash
node --test tests/model-library.test.js tests/local-studios.test.js tests/workflow-guides.test.js
node tests/models-browser.mjs
```

モデル重み・データセット・テスト出力はGitへ追加せず、再現コードと確認結果だけを非公開リポジトリで管理する。
