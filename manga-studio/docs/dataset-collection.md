# データセットの画像収集

A1には `dataset_sources`、`dataset_collect`、`dataset_collection_job` を登録しています。X・Pixiv・Gelbooruは gallery-dl 1.32.15、Pawchiveは専用アダプターを使います。準備だけの依頼では取得しません。

## 再導入と認証

PillowのAVIFコーデックが利用できるCaption StudioのPythonを使います。収集ライブラリーはモデル環境とは別の `upstream/dataset-collector-runtime` に配置します。リポジトリ直下で、pipのあるPythonから実行します。

```bash
python3 manga-studio/scripts/setup-dataset-collector.py
caption-studio/runtime/python-run manga-studio/scripts/collect-dataset.py --doctor
```

`manga-studio/dataset-collector.example.json` を `secrets/dataset-collector.json` にコピーし、権限を0600にしてローカルで編集します。Cookieファイルも0600で保管してください。XはNetscape形式Cookie、PixivはOAuth refresh token、GelbooruはAPI keyとuser ID、PawchiveはログインCookieを設定できます。値をA1との会話、URL、Gitに貼らないでください。ブラウザーからの自動Cookie抜き出しは行いません。認証情報が必要かはサイト・対象によります。

## A1から使う

1. `dataset_sources` で依存ライブラリーと認証設定の有無を確認します。
2. `dataset_collect(action:plan, dataset:sample, urls:[指定URL], limit:100)` で取得範囲を確認します。planはネットワークに接続しません。
3. 収集依頼がある場合は同じ引数の `action:run` を実行します。
4. 戻ったidを `dataset_collection_job` に渡します。中止は `action:cancel`。完了状態だけでなく downloaded / duplicates / failed / skipped を確認します。
5. 戻ったfolderの画像を選別し、`caption_open` で既存のキャプション工程へ渡します。収集だけでは学習を開始しません。

保存先は `datasets/incoming/<dataset>/`。originalsに原本、prepared/imagesにAVIF、provenance.jsonlに出所URL・SHA-256・取得日を保存します。長辺2048超だけ縮小し、quality95・4:4:4で変換します。同一内容の再収集では既存のAVIFや編集したキャプションを上書きしません。アニメーションは別に保持し、動画やZIPは収集しません。作者の説明やタグをキャプションとして自動採用しません。

1回1〜20URL、画像候補1〜1000件（既定100）、1画像40MiB・4000万画素まで。同時に同じデータセットへ書き込めません。ローカルの出所台帳とCookieを公開リポジトリに追加しないでください。設定変更を反映するには実行中のMang-AIを終了して再起動します。

## 検証範囲と制約

URL検査・画像の重複処理・キャプション保持・認証情報を返さない診断・セッションごとのジョブ操作をローカル試験します。実アカウントを使う各サイトの取得は別途必要で、サイト変更やログイン制限で失敗することがあります。401/403/429は迂回しません。

**Pawchiveの認証付きAPIは未検証です。** 公開API文書はログインが必要で、公開アクセスは403でした。Kemono互換を仮定した作者／投稿APIを実装しています。対応入力は `https://pawchive.pw/<patreon|fanbox|discord>/user/<id>` またはその `/post/<id>`。ログイン後に少数件でAPI形式を確認してから利用してください。現在のCDN許可先はpawchive.pwとそのサブドメインです。

資料: [gallery-dl対応サイト](https://github.com/mikf/gallery-dl/blob/master/docs/supportedsites.md)、[gallery-dl設定](https://github.com/mikf/gallery-dl/blob/master/docs/configuration.rst)、[Pawchive API案内](https://pawchive.pw/api/schema)。利用する画像の保存・学習条件は取得元で確認してください。
