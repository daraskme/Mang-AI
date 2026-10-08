# GLM Gen5・262K検証（2026-10-09）

検証したのは、RTX PRO 6000 Blackwell 96GB、i9-12900KS、DDR4-3200 128GiB、NixOS上のOrcaRouter GLM-5.3-Flash Uncensored Q4_K_Mです。A1 4B Q8を指揮役として常駐させました。

**262144枠に実入力260090 tokensを投入し、512 tokensの生成は17.1 tokens/s。50 tokens/sと元FP8相当品質の同時達成には至っていません。**

| 入力 / 生成 | prefill | decode | 検索 | prefix再利用 |
|---|---:|---:|---|---:|
| 8180 / 512 | 9.77秒 | 15.9 tokens/s | 3/3 | 0 |
| 260090 / 512 | 426.49秒 | 17.1 tokens/s | 3/3 | 0 |

合言葉は入力の10%、50%、90%付近に配置。生成コードは512 tokensで打ち切られ、実行していません。長文のHTTP時間457秒に、最初のモデルロード約70秒は含みません。1種類の長文検索結果を長文コーディング全般の品質へ一般化しません。

## 詳細データ・再現

検証の正本は専用エンジン側にまとめています。Mang-AIとの組合せは[固定コミット](../../integrations/strata-glm.json)で確認できます。

- [比較条件・メモリ・制約・採否の全記録](https://github.com/daraskme/Strata-GLM/blob/main/docs/optimization-gen5-262k.md)
- [実測JSON・固定seed・人工的な入力・再現方法](https://github.com/daraskme/Strata-GLM/tree/main/docs/benchmarks/2026-10-09)
- [ビルド・モデル取得・pack](https://github.com/daraskme/Strata-GLM/blob/main/README.MangAI.md)
- [通常の登録・保持・解放](glm-coding-session.md)

## 通常設定と試験条件の違い

長文速度は固定RAM tier 94.98 GiB / GPU expert pool 63.13 GiBで測定しました。通常登録は空きメモリに応じた可変予算で、RAM headroomを16 GiBへ増やし、実RAM tier 93.96 GiBを観測しました。この通常設定では共通APIの短文3検査に成功していますが、同じ26万入力を再測定した値ではありません。

CPUは8 workers・起動時の自動配分、spin 1ms、logical CPU 0〜15。先読みは0、均等expert slots、VRAM cap 90 GiB＋その内側のreserve 2 GiBです。固定CPU表や先読みは比較で一律改善せず、通常設定には採用していません。

GPU dense 5.34 GiB、KV/state 8.74 GiB、expert pool 63.13 GiB。prefill workspace約6184 MiBはexpert poolから借りるため二重加算しません。総GPU使用量はA1・画面等を含め最大88.44 GiB、空きRAM最小12.62 GiB、VRAM最小7.15 GiBでした。

システム全体のzram swap-outが約944 MiB増加しました。SSD swapではなく、プロセス別の帰属は未計測です。A1は全観測でreadyでしたが、負荷中の簡単な算術試験はprompt cacheを再利用しており、公平な遅延比較やp95保証にはなりません。

## 残る評価

1. 通常の可変予算で32K・128K・245K級入力を反復し、初期ロード、prefill、decode、RAM、zram、温度を別々に記録する。
2. A1へ未使用の指揮タスクを並行送信し、待ち時間の中央値・p95、生成中断、他のGPU工程への移譲を確認する。
3. CPU/GPU分担の変更は同一seed・同一予算・同一CPU表の対照で比較し、出力SHAとrouteの変化も区別する。
4. 品質はコードの実行テスト、tool引数、日本語、長文依存関係を、校正に使っていないデータで評価する。FP8参照との比較を行うまで「ほぼ元の品質」とは表現しない。
5. 独自量子化は指定FP8から作成し、混合bitの容量効果と品質を確認する。現行Q4からの再量子化、DMAへの変更、単一GPU MTPは今回の成果には含めない。
