# 外部接続のモデル設定（2026-10-09）

## 原因と修正

Harness `@deepseek-ai/dsh-client-ui-settings@0.2.1-alpha.1` は、ブラウザのホスト名がloopbackでない場合に設定ミラーを `memory` にし、`settings.describe` を呼びません。この状態で「設定 → モデル」を開くと `settings are unavailable in this browser` が表示されます。登録モデル・APIキー・Codex/Devinアカウントの消失とは別の問題です。同じ判定により、テーマや言語などの設定もサーバーから復元されませんでした。

`src/harness-settings.js` で、設定クライアントの永続化判定だけに例外を加えます。既存のloopback判定に加え、サーバーから注入された `remoteOrigin` とブラウザのHTTPS originが完全一致する場合にHost設定を利用します。ホスト名だけでなくポートも一致が必要です。公開URL未設定・別origin・平文HTTPでの例外適用はしません。

`isLoopback`、サーバーの認証、Host/Origin検査、Cloudflare Access、設定の秘密値伏字化、書き込み可否と競合チェックは変更しません。公開URLの利用者はこれまで同様にMang-AIの操作者として認証される必要があります。

## 検証

`tests/remote-settings-browser.mjs` は独立したDSHプロファイルと自己署名HTTPSプロキシで、次を確認します。実際のアカウント・APIキー・GPUモデルは使用しません。

- 修正前のクライアントで同じエラーを再現。
- 修正後のHTTPS接続でプロバイダー一覧を表示。
- モデル設定の画面編集・保存と、新しいブラウザコンテキストからの復元。
- 明暗テーマのHost保存・新しいブラウザと再読み込みでの復元。
- localhostは従来どおり動作し、別の許可済みホストには例外を適用しない。
- 未認証のindexと設定APIは拒否。起動overlayによる設定の書き込み禁止も保持。

本番でもlocalhostとCloudflare Access経由のHTTPS URLから、モデル一覧・4件の編集ボタンが表示されることを確認しました（設定値は変更せず、ブラウザエラー0件）。サービス再起動前後で登録アカウント5件が保持されています。保存試験は本番設定を変更せず、上記の隔離プロファイルで実施しています。

```sh
node_modules/.bin/node tests/harness-settings.test.js
OPENSSL_PATH=/path/to/openssl CHROME_PATH=/path/to/chrome node_modules/.bin/node tests/remote-settings-browser.mjs
```

OpenSSLがPATH内にあれば `OPENSSL_PATH` は不要です。証明書と設定は `.test-output/remote-settings-*` に隔離します。`harness-settings.test.js` はoriginの適用範囲、再適用、未対応版・変更されたバンドルの拒否を検証します。

## 運用と対応版

`npm run configure` と通常の `npm start` は補正を検査・適用するため、依存パッケージの再導入後も復元できます。修正済みの同じ内容には書き込みません。対応版と元バンドルのSHA-256を固定しているため、Harnessの版・内容が変わった場合は自動適用を止めます。更新時は補正がまだ必要かを確認し、上記のHTTPS試験を行ってから対応を更新してください。

起動overlayで固定されたA1/GLMなどの設定は、引き続き `studio.config.json` から変更します。この補正はoverlayの優先順位を変えません。Codex/Devinのログインとセッションごとの担当選択は「AIアカウント」で管理します。

反映後、開いていたブラウザは一度再読み込みしてください。アカウントの再登録は不要です。
