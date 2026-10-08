# Cloudflare Tunnelで外部から接続する

名前付きTunnelとCloudflare Accessを使い、Mang-AIのGUIをHTTPSの固定URLで開きます。DSH、ギャラリー、画像編集、統合生成画面は同じoriginで動き、メディア用画面は `/mang-ai/` 配下です。推論APIや各ネイティブStudioのポートはlocalhostのままにします。

必要なものはCloudflareで管理するドメイン、Zero Trust、Google OAuthクライアント、cloudflaredです。PCとMang-AIを起動しておく必要があります。ルーターのポート開放は不要です。

## Google IDプロバイダーとAccess

1. Google Cloudでウェブアプリ用OAuthクライアントを作成します。チームドメインが `YOUR-TEAM.cloudflareaccess.com` なら、JavaScript生成元は `https://YOUR-TEAM.cloudflareaccess.com`、リダイレクトURIは `https://YOUR-TEAM.cloudflareaccess.com/cdn-cgi/access/callback` です。
2. Cloudflare Zero Trust → Integrations → Identity providers → GoogleへクライアントIDとシークレットを登録し、Testで確認します。Googleがテスト状態なら、自分をテストユーザーへ追加します。
3. Access → ApplicationsでSelf-hostedアプリを作り、使うホスト名（例 `mangai.example.com`）を登録します。Googleをログイン方法に選択します。
4. Allowポリシーは使うGoogleアカウントのメールアドレスに限定します。アプリ全体を保護し、パスの空欄はホスト全体を意味します。公開目的でない限り、EveryoneやBypassは使いません。
5. アプリの **Application Audience (AUD) Tag** を控えます。次の設定ではcloudflared自身もAccessのJWTを検証します。

Google IDプロバイダーの登録と、「誰を許可するか」のAccessポリシーは別の設定です。`cloudflared tunnel login`の証明書にはAccessの作成権限がない場合があります。その場合はダッシュボードで設定し、シークレットや証明書をチャット・Gitへ貼り付けないでください。

Google用のPKCEは有効にできます。Testで `User email was not returned` と表示され、IDと名前だけが返る場合は、メール取得権限の要求と同意を確認します。Google Auth Platform → データアクセスで `openid`、`https://www.googleapis.com/auth/userinfo.email`、`https://www.googleapis.com/auth/userinfo.profile` を確認して保存し、再度Testします。メールの共有にも同意してください。改善しない場合はGoogleアカウントの接続管理で、このOAuthアプリの接続だけを解除してから再認証します。スコープ登録だけで認証リクエストや以前の同意が更新されるとは限りません。Gmailの読み取り権限は不要です。[Googleのメール取得仕様](https://developers.google.com/identity/openid-connect/openid-connect#obtaininguserprofileinformation)

再同意でも改善しない場合の切り分けとして、同じGoogleクライアントを使って **OpenID Connect** プロバイダーを追加できます。Auth URLは `https://accounts.google.com/o/oauth2/v2/auth`、Token URLは `https://oauth2.googleapis.com/token`、Certificate URLは `https://www.googleapis.com/oauth2/v3/certs`、Email claim nameは `email`、スコープは `openid`・`email`・`profile`、PKCEは有効です。保存後、新しいプロバイダーでTestし、成功を確認してからAccessアプリのログイン方法を切り替えます。これは代替構成で、元のエラー原因を確定したものではありません。[Cloudflare OIDC](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/generic-oidc/)と[Googleの公開設定](https://accounts.google.com/.well-known/openid-configuration)を参照してください。

公式資料：[Google IDプロバイダー](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)、[Tunnel作成](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/create-local-tunnel/)、[Access JWTの検証](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/)。

## PC側の設定

```bash
cloudflared tunnel login
cloudflared tunnel create mang-ai
python3 manga-studio/scripts/configure-cloudflare.py \
  --hostname mangai.example.com --team YOUR-TEAM \
  --aud YOUR_64_CHARACTER_AUD --tunnel YOUR_TUNNEL_UUID \
  --cloudflared /absolute/path/to/cloudflared --write
```

`--write`なしなら検査と計画表示だけです。設定前の `studio.config.json` は `work/remote-access/` に保管します。秘密ファイルは `secrets/cloudflare/` と `~/.cloudflared/` に置きます。user systemdの `mang-ai-web.service` と `mang-ai-tunnel.service` を作りますが、設定スクリプトはサービスを開始・停止しません。

```bash
cloudflared tunnel --config /absolute/path/to/Mang-AI/secrets/cloudflare/config.json ingress validate
cloudflared tunnel route dns YOUR_TUNNEL_UUID mangai.example.com
systemctl --user daemon-reload
# 実行中の処理が完了し、手動起動のMang-AIを終了してから
systemctl --user enable --now mang-ai-web.service mang-ai-tunnel.service
```

待受は `127.0.0.1:17860`（`--port`で変更可能）。起動スクリプトは `remoteOrigin` をDSHの `--public-url` と `--trusted-host` へ渡します。既存DNSがある場合は内容を確認し、無条件に上書きしないでください。既存の手動Mang-AIとsystemdを同じ保存先で二重起動することはできません。

Accessでログインした後もDSH自身の認証は保持します。起動時に表示される認証付きURLを、自分の端末だけで使ってください。再起動でDSHのトークンは更新されます。認証付きURLを公開READMEへ貼らないでください。

## 確認と停止

- ログアウトしたブラウザがAccessのログイン画面へ移動し、会話・画像・APIを読めないこと。
- 許可したGoogleアカウントで会話・ギャラリー・動画Range再生・生成結果を開けること。
- 別回線のスマートフォンでも同じ動作になること。各ネイティブStudioへのlocalhostリンクはこのTunnelの対象外で、統合画面とA1のツールを使います。
- PCがスリープすると接続できません。userサービスの自動開始はログイン状態とOSのuser manager設定に依存します。

停止は `systemctl --user stop mang-ai-tunnel.service`、自動起動解除は `systemctl --user disable mang-ai-tunnel.service`。GUIのローカル利用は継続できます。

ローカルのHost/Origin拒否、認証、同一URL配下のギャラリーと生成画面は自動試験に含まれます。Google認証とインターネット経由の到達確認は、それぞれのCloudflareアカウントで設定後に実施してください。
