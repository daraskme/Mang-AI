# Mang-AI — DSH ローカル漫画制作

DeepSeek Harness を漫画制作向けに拡張するプラグインです。DSH の1セッションを1作品に対応させ、脚本、コマ画像、吹き出し、日本語文字、編集履歴を保存します。

[機能・モデル・LoRA学習の確認結果（2026-10-05）](docs/feature-audit-2026-10-05.md) に、実装済み機能と未検証・未統合の範囲をまとめています。Krea 2の新規LoRA学習は対応済み、H3の新規LoRA学習は未統合です。

セッション上部の **メディア** またはサイドバーの **ギャラリー** で、チャットの横に制作スペースを開きます。**このセッション／すべての素材** を切り替え、プレビューから同じ画面内で漫画・画像の編集を再開できます。幅の調整・全画面化にも対応し、セッションを切り替えても訪問済みパネルの未保存編集を保持します。別の編集対象への移動時は未保存の文字・マスクがあれば保存・処理を促します。

制作スペースの **制作の進捗** では選択したセッションを、セッション未選択時には全漫画を確認できます。漫画編集画面にも脚本・台詞・作画・画像修正・書き出しの状況を表示し、2秒ごとに更新します。作画中は生成済みコマ数と生成環境が返す処理状況、失敗時はエラーを表示します。文字の未保存編集を進捗更新で上書きしません。

| 担当 | 使用するもの |
|---|---|
| 日本語脚本・台詞 | Gemma Ortenzya 31B のローカル OpenAI 互換 API |
| 制作進行・ツール操作 | Agents A1 4B Q8を常駐させるローカルAPIとDSH |
| コーディング | Qwen3.8 Flash Next Q8 / Strata。配置・変換済み、実機推論はVM停止待ち |
| 文字なしのコマ絵・単画像 | 既存 Krea 2 Studio の公式 Diffusers Python 推論。既定は Turbo |
| 動画・音声 | 既存 MiniMax H3 Studio |
| 自然言語キャプション | Caption Studio の画像認識 Gemma |
| Krea 2 LoRA 学習 | Caption Studio / Musubi Tuner、RAW DiT |
| 吹き出し・文字入力 | `manga_letter` 専用ツールとブラウザ編集画面 |
| 画像の消去・補完 | daraskme/IOpaint の LaMa と共通編集GUI |
| 画像・動画のモザイク | daraskme/mosaic_editor の検出・SAM2追跡・マスク処理と共通編集GUI |

Gemma の台詞を画像モデルへ転記しません。Krea はコマ単位の絵を生成し、ページのコマ割りと台詞は SVG として合成します。文字修正に再作画は不要です。Kreaは公式Python推論、H3単発は既存Python環境、H3長尺はローカルComfyUI上のH3-LongVideosを使います。

## 現在の状態と起動

アプリ、依存関係、Krea 2・H3・キャプション・LoRA 学習環境を `/mnt/solidigm-b/Mang-AI/` に配置しています。司令塔はAgents A1 4B Q8、日本語創作はOrtenzya 31B Q8、キャプションはUNSEEN Gemma 4 26B Q4と画像プロジェクターです。共通APIは `127.0.0.1:1234`、A1は1240で常駐、Gemmaは1241、コーディング用Strataは1242で必要時に起動します。Qwen Flash Next Q8の実機推論は利用者によるVM停止待ちです。[構成・導入・検証範囲](docs/local-agent-architecture.md) を参照してください。

```bash
cd /mnt/solidigm-b/Mang-AI/manga-studio
npm start
```

KDEタスクバーに登録した緑の吹き出し「Mang-AI」、アプリ一覧の「Mang-AI」、またはこのフォルダの `Mang-AI.desktop` でも起動できます。

DSH は空きポートで起動し、URL を表示します。自動でブラウザを開かない場合は `npm start -- --no-open`。ポート固定は `npm start -- --port 3082`。吹き出し編集サーバーは既定で `127.0.0.1:4317`。このサーバーは DSH プラグインの起動・終了に従います。

他の DSH プロファイルを変更せず、このフォルダの `.dsh/` にプロファイルと会話を保存します。再起動は同じプロファイルを使います。フォルダ移動後は `npm run configure` または `npm start` が絶対パスを作り直します。

再インストールは `npm ci`。検証用に公式 Node 24.13.0 をプロジェクト内へ固定しています。NixOS では導入後、シェルから `node scripts/prepare-nixos.mjs` を実行してください。`/nix/store` の glibc / libstdc++ / patchelf を使って、プロジェクト内の Node だけを調整します。現在の環境では調整済みです。

## モデル接続

[studio.config.example.json](studio.config.example.json) を元に作成された `studio.config.json` を編集します。相対パスは設定ファイルの場所を基準にします。設定変更後は DSH を再起動してください。

漫画制作の工程とモデルの役割は [漫画制作の方針](docs/manga-production-policy.md) にまとめています。エージェントは `manga_workflow_guide` で全体または必要な工程を参照できます。GPU切替を含む構成変更の設計は [常駐エージェントとGPU工程管理](docs/local-agent-architecture.md) を参照してください。

### A1 / Gemma / Qwen

LM Studio や llama.cpp などで各モデルを OpenAI Chat Completions 互換 API として起動し、`agent`（司令塔）、`gemma`（創作）、`coder`（コーディング）の `baseURL` / `model` を実際の値にします。既定URLは `http://127.0.0.1:1234/v1`。modelには **`GET /v1/models` が返すid** を指定します。`qwen` は旧構成の互換設定です。管理下のGPU切替を使う場合は [常駐モデルの導入手順](docs/resident-model-setup.md) に従います。

環境変数 `MANGA_AGENT_URL` / `MANGA_AGENT_MODEL`、`MANGA_GEMMA_URL` / `MANGA_GEMMA_MODEL`、`MANGA_CODER_URL` / `MANGA_CODER_MODEL` でも上書きできます。認証がある場合だけ各役割の `MANGA_*_API_KEY` を環境変数で渡します。認証なしローカルAPIには起動スクリプトが `local` を仮のキーとして使います。

### 既存の Krea 2・H3・キャプション環境

既定は `krea.backend: "studio"`。移動した `krea2-darask/` の公式 Diffusers Python 推論に接続します。デスクトップの既存 Krea 2／H3 起動・停止アイコンも使えます。

| 環境 | パス | GUI / API |
|---|---|---|
| Krea 2 | `/mnt/solidigm-b/Mang-AI/krea2-darask` | `http://127.0.0.1:8189` |
| H3 | `/mnt/solidigm-b/Mang-AI/minimaxH3-darask` | `http://127.0.0.1:7862` |
| H3 モデル | `/mnt/solidigm-b/Mang-AI/models/h3` | — |
| キャプション・学習 | `/mnt/solidigm-b/Mang-AI/caption-studio` | `http://127.0.0.1:3210` |

`media_service` の `provider: krea / h3 / caption` と `action: start / stop` でサーバーを起動・停止し、`media_status` で状態・モデル・LoRA を確認します。停止は待機中に限ります。画像・動画・キャプション・学習はそれぞれ GPU メモリを使うので、必要に応じて使い終わった環境を停止します。別アプリの GPU プロセスは自動終了しません。

Krea 2 の新しい画像は `krea2-darask/outputs/`、H3 は `minimaxH3-darask/outputs/`、学習結果は `caption-studio/training-runs/` に保存します。元パスには互換リンクを残しているため、仮想環境・旧履歴からの参照を保ちます。NixOS の CUDA・Python・ドライバーは OS の `/nix/store` を使います。

このPCではH3の `memoryProfile: "shared"` を設定します。生成TransformerはINT8、テキストエンコーダーはINT4でGPUに保持し、Qwen併用時のメモリを節約します。`resident` はTEもINT8で保持する設定です。`h3_generate` の `memory_profile` でも切り替えられます。CPU退避は大きな空きRAMを必要とします。

## 日本語エージェントとプラグイン

エージェントプリセットは「Mang-AI」の1つです。DeepSeekのモデル・認証・検索経路を無効にし、DSHのツール実行機構をローカルA1に接続しています。画面と公式プラグインの設定表示は日本語化しています。

旧Qwen 27BによるWeb検索と生成画面ツール呼び出し、実Ortenzyaによる日本語脚本の生成記録があります。新しいA1でもツール呼び出しと画像入力を確認しました。A1は常駐し、大規模モデルは共通GPUキューで順に実行・解放します。画像認識には読順や動作の誤認があるため、設定・脚本・利用者の指摘を併せて判断します。

Agent Teams、Auto Authorization Review、Developer Tools、Voice input、Shell、Agent loop、Subagent、Web searchを有効化しています。通常はA1を使い、コーディングのsubagentだけ `manga-coder / qwen3.8-flash-next-q8-strata` を指定します。音声入力はローカルSenseVoiceです。Web検索はBing RSSを既定とし、設定からSearXNGにも接続できます。検索語は検索サービスへ送信し、回答はローカルモデルが作ります。

制作スペースの **モデル・LoRA** ではKrea/Kroma・H3・長尺環境の一覧を表示し、モデル、LoRAごとの強度と人物/Style用途をセッションに保存できます。自分のPNG/JPEG/WebPをサムネイルとして登録できます。動画生成の作品名を指定すると、ギャラリーの **動画作品** に生成・高解像度化した版をまとめます。既存動画はセッションごとの「既存の動画」にまとめます。

## メディアギャラリーと整理済み素材

サイドバーの **ギャラリー** とセッション上部の **メディア** は統合パネルを開きます。生成画面・単独編集画面のリンクとエージェント用の `media_open_gallery` からは独立画面も利用できます。

- 制作中の漫画：全セッションの作品を選び、現在のページを吹き出し付きで確認。「漫画の編集を再開」で選択ページへ戻れます。
- セッションのメディア：生成・編集した画像と動画をセッション別に表示します。
- データセット：名前やファイル名で検索し、サムネイル、元サイズ、同名TXTの自然言語キャプションを確認できます。
- 生成環境の履歴：Krea 2、H3、長尺動画の出力を閲覧できます。動画は再生・シーク、静止画はIOPaint・モザイク編集への受け渡しに対応します。

一覧は48件ずつ読み込み、サムネイルはローカルFFmpegで作成・キャッシュします。ギャラリーの認証トークンは編集API用と分離しています。元ファイルは表示で変更せず、修正・モザイクを開くと編集用コピーを作ります。

旧 `/run/media/hiroshi/ボリューム/H3` と `krea2` の素材はチェックサム照合後に移行し、旧パスには互換リンクを残しました。

| 内容 | SSD内の保存先 |
|---|---|
| Krea 2データセット32組 | `datasets/krea2/imported/`（chara / concept / style） |
| H3データセット16組 | `datasets/h3/imported-v2/` |
| Krea 2最終LoRA24本 | `krea2-darask/models/loras/krea2/user/style/` |
| H3最終LoRA8本 | `models/h3/loras/user/concept/` |
| 全チェックポイントと学習履歴 | `training-runs/krea2/imported/`、`training-runs/h3/imported/` |
| 旧設定・補助ファイル | `archives/previous-training/` |

登録簿は `models/training-library.json`。`media_library` で検索し、返された `loraId` を生成、`path` を `caption_open` に使えます。`@akipeko`（464リンク）と `@maud0210`（232リンク）は元フォルダにも画像・キャプション実体がなく、保存場所は不明です。ギャラリーでは「元画像なし」と表示します。両者の学習済みLoRAは登録済みです。

## 生成・長尺動画・高解像度化

「生成画面を開いて」で `media_open_generator` を使います。モデル・LoRAの選択、手動生成、進捗・中止、結果の高解像度化ができます。

Krea 2にはMUSE v3.5 INT8 Extended、Moody V8.0、Redcraft 3.0を登録しています。INT8 ConvRotの演算に対応し、生成は8ステップ、確認用は4ステップ加速LoRA、Hiresは既定1.5倍・4ステップ・denoise 0.25です。3モデルの実生成とRedcraftの768px Hiresを確認しています。

[lodestones/Kroma](https://huggingface.co/lodestones/Kroma) の `kroma-v0.3-turbo.safetensors` を導入済みです。モデルIDは `kroma-v03-turbo`。BF16の本体と既存Kreaのエンコーダー・VAEを使い、8ステップ生成、スタイルLoRA、生成後のHiresを選べます。Kromaでは未検証の汎用4ステップLoRAを自動追加しません。配布元のREADMEの推奨値はv0.2向けですが、v0.3もこの環境で実生成を確認しました。

RTX PRO 6000で、整理済み `krea2_manga_style` LoRA（強度0.6）を使った512×512・8ステップ生成は読込込み17.9秒（推論2.0秒）、768×768への1.5倍・4ステップHiresは1.7秒でした。PyTorchのGPU予約メモリ最大は約36.0GiB。これは1枚の動作確認結果で、解像度・LoRA・プロンプトで変わります。試験後はモデルを解放しています。

生成画面で **モデル一覧を更新 → Kroma v0.3 Turbo** を選びます。漫画編集画面でも **作画モデル → モデル一覧を更新** から選べます。エージェントには「Kromaで生成して」と指示でき、`krea_generate` と `manga_render` の `model_id: "kroma-v03-turbo"` で指定します。漫画ジョブにはモデル・LoRAを保存するので、待機中に既定値を変えても選択が保持されます。

別環境への導入は `python3 manga-studio/scripts/setup-kroma.py`。固定リビジョンの約25.6GBをSSDへ少量ずつ保存し、SHA-256を照合してから登録します。中断時は再実行で再開でき、Civitaiキーは送信しません。既存KreaのDiffusers構成が必要です。重み自体はGitHubに保存しません。

H3にはEros Max beta5 INT8、DaSiWa Hybrid Turbo v3を追加しています。蒸留済みモデルは8ステップを既定とし、加速LoRAの二重適用を防ぎます。`h3_generate` の `latent_refine` は低解像度生成→潜在拡大→短い再生成、`media_upscale` は生成済み動画の画素拡大です。

Eros beta5のsharedモードで、512×288・8ステップ→潜在768×448→4ステップの再生成→124フレーム・約5.2秒のMP4出力を確認しました。モデル読込を含むこの試験は約144秒でした。GPUと大容量RAMを使う生成・学習・モデル読込の前には、エージェントから処理内容と負荷の見込みを知らせます。

長尺動画は `media_service(provider:longvideo,action:start)` → `h3_longvideo_plan` → `h3_longvideo_generate` → `media_job` の順で使います。共通設定を最初の段落に書き、空行で区切った各段落を1ショットにします。既定はDaSiWa v3・8ステップ・0.4MP、1ショット8秒。最大24ショット・計画尺120秒です。出力はフレーム単位に調整され、予定秒数とは少し異なります。

Smite79の実コードで3ショット・約19.7秒・472フレームのMP4出力を確認しています。潜在1.5倍では896×512で出力しました。この長尺機能の潜在拡大は生成後・VAE復号前に行い、拡大後の拡散リファインはしません。ネイティブH3の `latent_refine` と処理が異なります。台詞のない試験出力の音声は無音でした。音声トラックの存在だけでは音声内容の成功と判定しません。

長尺実行環境は `127.0.0.1:8190`、出力は `work/longvideo/`。GPUを大きく使うため、別の生成環境が待機中なら停止してから開始してください。エージェントとGUIの停止操作は実行中ジョブを保護します。

### 公式リポジトリの Python を直接使う場合（任意）

既存 Studio を使う通常設定では以下の追加導入は不要です。`krea.backend: "python"` に切り替えた場合のみ、次の独立した公式コード用の環境を指定します。

[公式コード](https://github.com/krea-ai/krea-2) は `upstream/krea-2/` に取得済みです。CUDA が使える Python 3.12 以降の環境で依存関係を導入します。

```bash
cd /mnt/solidigm-b/Mang-AI/upstream/krea-2
uv sync
```

公式の [Krea-2-Turbo](https://huggingface.co/krea/Krea-2-Turbo) の重みを保存し、`krea.weights` に実ファイルの絶対パスを指定します。環境変数 `OSS_TURBO` でも指定できます。設定の `krea` 節の例：

```json
{
  "backend": "python",
  "repo": "../upstream/krea-2",
  "python": "../upstream/krea-2/.venv/bin/python",
  "checkpoint": "oss_turbo",
  "weights": "/mnt/solidigm-b/models/krea-2/実際の重みファイル.safetensors",
  "width": 1024, "height": 1024,
  "steps": 8, "cfg": 0, "mu": 1.15,
  "timeoutMs": 1800000
}
```

`width` / `height` はコマ画像の外接サイズです。コマ比率に合わせ16の倍数へ調整します。公式の `inference._pipeline()` / `sampling.sample()` を呼び、1ページのコマを同じモデルで順番に生成します。ページ間ではプロセスを終了します。Gemma/Qwen サーバー側のモデルのロード・アンロードは、そのサーバーで設定してください。

RAW なら `checkpoint: "oss_raw"`、RAW 重み（または `OSS_RAW`）、`steps: 52`、`cfg: 3.5` に変更します。Krea のエンコーダー等は公式コードが別途取得する場合があります。モデルのダウンロードやライセンス同意は、このツールが自動代行しません。

```bash
cd /mnt/solidigm-b/Mang-AI/manga-studio
npm run doctor
```

モデル ID と各 Studio の接続を確認します。Python 直接方式では公式コード・Python・重みの存在も検査します。推論は実行しません。

## エージェントへの画像・動画・LoRA の依頼

```text
Krea 2 で、雨上がりの駅の背景を生成して。文字は入れないで。
その画像を先頭フレームにして、H3 で約5秒の動画を作って。
```

`krea_generate` / `h3_generate` はジョブIDをすぐ返します。`media_job` で進捗・結果URLを確認し、必要なら `action: cancel` で停止します。完成結果はセッションの `media/` へ回収し、`outputPath` を返します。H3 の `firstFramePath` / `lastFramePath` にはこの画像パスやローカル PNG/JPEG/WebP を指定できます。ジョブの操作は投入した DSH セッションに限定します。

```text
「画像フォルダの絶対パス」の画像から、キャラクターLoRA用の
英語の自然言語キャプションを作って。トリガーは my_character。
既存キャプションは残し、できた文章を同名.txtに保存して。
そのデータで推奨設定の Krea 2 LoRA を学習し、完了したら
my_character という名前で Krea 2 に登録して。
```

`caption_open` に画像フォルダと `settings: {mode:"character", trigger:"my_character", language:"en"}` を指定します。画風なら `mode:"style"`、概念なら `mode:"concept"`。`learn` / `describe` / `concept` で覚えさせる特徴と画像ごとの違いを分けます。Caption Studio は一度に1フォルダを編集します。別画面でフォルダが変わったら、このセッションからの変更は拒否し、開き直すよう案内します。

`caption_generate` は画像認識モデルを必要時に起動し、準備後に一括生成します。`caption_status` / `caption_edit` で内容を読み修正し、`caption_save` で .txt に書き出します。生成だけでは下書きです。既存の .txt はバックアップし、外部変更時は競合として止めます。`caption_cancel` で中断できます。

`lora_prepare` が3枚以上の画像、非空キャプション、トリガー、RAW 重み、GPU を検査し、設定・警告・実行コマンドを返します。`lora_run` の `action:start` で学習し、`status` / `stop` で追跡・停止します。学習は実行ごとの画像・キャプションのコピーを使い、元画像を変更しません。`lora_install` が完成モデルとトリガーを Krea 2 の LoRA フォルダへ保存します。登録後は `media_status(provider:krea)` が返す ID とトリガーを `krea_generate` に渡します。

## IOPaint 修正・モザイク

漫画の文字編集画面の「画像修正・モザイク」から、生成済みのコマを選んで開きます。エージェントには次のように依頼できます。

```text
1ページ目の最初のコマを、IOPaintで手直しできる編集画面で開いて。
「画像またはMP4の絶対パス」をモザイク編集画面で開いて。
対象を自動検出してモザイクをかけ、結果をGUIで確認できるようにして。
```

GUIでは、ブラシ・矩形・消しゴムで範囲を指定し、「選択範囲を修正」でIOPaint / LaMaによる消去・補完、「選択範囲にモザイク」で手動処理できます。「範囲を自動選択」は検出結果を手描きで調整でき、「自動でモザイク」は検出から処理まで行います。対象カテゴリと検出しきい値を選べます。SAM2の輪郭補正も使用できます。IOPaintは周辺画像からの補完で、文章を指定する再生成には対応していません。

元ファイルと各編集版は保存します。比較、版を戻す、結果のダウンロードが可能です。「コマに反映」で漫画に反映し、吹き出し・文字はそのまま残ります。元のコマが別の操作で再生成されていた場合は反映を止めます。処理中に画面を再読み込みしても進捗と中止操作を再開できます。

MP4は再生・シーク、処理時間の指定に対応しています。手描き範囲は指定時間の同じ位置に適用し、自動処理はmosaic_editorのSAM2動画追跡を使います。書き出しはH.264で映像を再圧縮し、元の音声トラックをコピーします。IOPaint補完は静止画のみです。自動動画処理の上限は幅×高さ×フレーム数で3億、画像は3200万画素、入力ファイルは4GBです。

| ツール | 操作 |
|---|---|
| `media_open_editor` | コマの `pageId/panelId` またはファイルの `path` を開き、編集ID・版番号・GUIリンクを取得 |
| `media_edit` | `mode: inpaint / mosaic / detect`。矩形 `regions`、PNGマスク、`autoDetect` を指定して開始 |
| `media_edit_status` | 編集IDと任意のジョブIDから履歴・進捗・結果を確認 |
| `media_edit_cancel` | 実行中・待機中の処理を中止 |
| `media_edit_commit` | 漫画のコマへ反映、または独立ファイルの保存先を取得 |

矩形はページ全体の座標ではなく、元画像のピクセル座標です。例：`regions: [{x:100,y:80,width:160,height:120}]`。`block:0` は自動サイズ、`categories` は `penis / vagina / nipples / mosaic`、動画の範囲は `startSeconds/endSeconds` です。検出しただけのジョブは画像を変更しません。

実体は `upstream/IOpaint/` と `upstream/mosaic_editor/`、共通Python環境は `upstream/IOpaint/.venv/`、モデルキャッシュは `models/editing/` です。このPCではCPU版PyTorchを導入し、生成・学習用のGPUと分けて実行します。LaMa、AnimeCensor、SAM2はダウンロード済みです。設定は `editing.python / mosaicRepo / cacheDir / wrapper / timeoutMs`。NixOSの共有ライブラリは `python/run-edit.sh` が解決します。

再構築用の依存一覧は `python/editing-requirements.txt`。CPU版PyTorchのindexを利用して `uv pip install --python ../upstream/IOpaint/.venv/bin/python --torch-backend=cpu -r python/editing-requirements.txt` で導入できます。IOPaintリポジトリの指定コミットも必要です。

## 漫画の使い方

DSH でこのフォルダをワークスペースとして新しいセッションを作り、例えば次のように依頼します。

```text
このセッションで4ページのフルカラー漫画を作って。
人物設定と話者を固定し、日本語脚本は Gemma に依頼して。
台詞は manga_letter で入力し、脚本を確認できる編集画面を出して。
```

1. `manga_create` で現在のセッションの作品を作ります。
2. `manga_draft` が人物設定を含めて Gemma に脚本を依頼します。台詞規約はリポジトリの `guidelines/02-narrative-craft.md` §4-10 を読みます。
3. Qwen が `manga_letter` で台詞を配置します。編集画面の「吹き出しに入力」も同じ文字入力処理を使います。
4. `manga_open_editor` のリンクで脚本を確認し、「脚本を確定」を押します。
5. DSH に作画を依頼するか、編集画面の「このページを作画」を押します。生成中も文字を編集できます。
6. `manga_export` で閲覧・印刷用 HTML、ページ SVG、編集 JSON を出力します。編集画面の PNG ボタンは現在のページを 2000×2828 で保存します。HTML はブラウザの印刷から PDF にできます。

1ページ2〜4コマです。脚本を直すと確定状態を解除し、作画指示が変わったコマを作画待ちに戻します。既存の吹き出しは保持するので、内容と位置を確認してください。文字編集では画像の再生成は不要です。

## 吹き出し入力の例

`manga_status` で最新の `revision` を読み、`manga_letter` に渡します。

```json
{
  "revision": 2, "pageId": "p1", "action": "upsert",
  "bubble": {
    "id": "saki-01", "speaker": "紗季", "text": "これ、あなたに。",
    "kind": "speech", "direction": "vertical",
    "x": 720, "y": 70, "width": 180, "height": 300,
    "fontSize": 30, "tailX": 690, "tailY": 420
  }
}
```

座標はページ全体の `1000×1414`。同じ id は更新、新しい id は追加。削除は `action: "delete"` と `id`。形は通常・思考・四角枠・文字のみです。**漫画の台詞は縦書きが基本**で、上から下、列は右から左へ読みます。新規入力で `direction` を省略すると `vertical`、既存吹き出しの更新で省略した場合は現在の方向を保ちます。横書きが必要な箇所は `horizontal` を指定できます。

編集画面の **このページの台詞を縦書きに**、または `manga_letter` の `action: "verticalize"` で、そのページの通常・思考の吹き出しをまとめて縦書きにできます。本文、位置、画像は保持され、保存履歴から戻せます。縦書きでの改行は次の左列へ送ります。句読点・閉じ括弧の行頭禁則、開き括弧の行末禁則、連続する三点リーダー・ダッシュの分断を簡易処理します。溢れる文字は警告し、吹き出しの寸法や文字サイズで調整します。SVG・PNG・印刷用HTMLも同じ縦組みです。日本語フォント（Noto Sans CJK JP など）が必要です。

## 保存・中断・復元

| 保存先 | 内容 |
|---|---|
| `manga-studio/.dsh/` | DSH 会話・プロファイル |
| `work/manga/studio.sqlite` | 作品、版履歴、ジョブ |
| `work/manga/<session-key>/images/` | コマ PNG |
| `work/manga/<session-key>/requests/` | Gemma 入出力 |
| `work/manga/<session-key>/exports/` | 新しいフォルダに毎回書き出し |
| `work/manga/<session-key>/media/` | Krea・H3の生成結果 |
| `work/manga/<session-key>/edits/` | IOPaint・モザイクの元ファイルと各編集版 |

同じ DSH セッションを開き、`manga_status` で再開します。新しいセッションは別作品になります。古い編集内容で新しい版を上書きしようとすると競合を返します。`manga_history` は直近100件を表示し、`manga_restore` は指定版を新しい版として復元します。

Krea ジョブは全セッションで直列実行します。`manga_cancel` または編集画面から中止でき、再実行は不足コマだけを生成します。異常終了時も完成済み PNG を次回起動で回収します。意図的な再作画は `manga_render` の `regenerate: true`。旧画像は保持します。

編集リンクはセッション専用で、DSH 再起動後には取り直します。編集サーバーは localhost のみで待ち受け、別セッションのトークンや他サイトからの書き込みを拒否します。

## 検証と対応版

`node_modules/.bin/node tests/workspace-browser.mjs` は統合画面の作品絞り込み、全素材表示、未保存編集の保持と移動保護、進捗、空のセッション、モバイル表示を検証します。`TEST_URL='<起動中DSHのURL>' node_modules/.bin/node tests/workspace-dsh-browser.mjs` は通常GUIでチャット横のパネルとセッション切替を確認します。実モデルを読み込まず、後者もテスト入力を保存しません。

`node_modules/.bin/node tests/models-browser.mjs` はモデル/LoRAのセッション別選択、個別強度・用途、サムネイル登録、未保存値の保持を検証します。`python3 -m unittest discover -s tests -p 'test_*gpu*.py'` はGPUを使わず共通待機・中止と長尺サーバーの失敗保持を検証します。実A1→Gemma→Kromaの試験手順は [常駐モデルの導入記録](docs/resident-model-setup.md#検証) を参照してください。

```bash
npm test
npm run test:browser
npm run test:dsh
python3 tests/test_python_bridge.py
```

ギャラリーのAPI・トークン分離・パス制限・動画Rangeは `npm test` に含まれます。`node_modules/.bin/node tests/gallery-browser.mjs` はローカルの既存テスト画像・動画を使い、サムネイル、再生、キャプション、漫画編集への移動、モバイル表示を確認します。新しい画像・動画の生成はしません。`tests/live-h3-hires.mjs`、`tests/live-longvideo.mjs` はGPUを使うため、実行前に利用者へ知らせてください。

KromaのGUI選択は `node_modules/.bin/node tests/kroma-browser.mjs`（Kreaサーバー起動済み、生成なし）。実モデルの生成とHiresは `tests/live-kroma.mjs`（GPUを使用、実行前に通知）。`TEST_STYLE_LORA=1` で整理済み漫画スタイルLoRAも使います。`TEST_SERVICE=1 node_modules/.bin/node tests/dsh-smoke.mjs` は実DSHの管理プロセスでKreaサーバーを起動・停止しますが、モデルは読み込みません。

縦書きは `node_modules/.bin/node tests/vertical-browser.mjs` で、文字の上下方向・列の右左順・一括変更・保存後の復元・SVG/PNG書き出しを確認します。GPU生成やモデル読み込みは行いません。

実際の漫画制作は `tests/live-manga-workflow.mjs` で検証できます。通常の漫画ライブラリーへ新しい作品を保存するため、通常GUIを終了してから実行します。`author` と `render` は実モデルをロードしGPU・RAMを使います。実行前に利用者へ通知してください。

```bash
node_modules/.bin/node tests/live-manga-workflow.mjs author
# 表示された実行ディレクトリを、以下の <run-dir> に指定
node_modules/.bin/node tests/live-manga-workflow.mjs approve <run-dir>
node_modules/.bin/node tests/live-manga-workflow.mjs render <run-dir>
# 必要な場合、目視で選んだ範囲を repairs.json に保存して実画像の補完も検証
node_modules/.bin/node tests/live-manga-workflow.mjs repair <run-dir>
node_modules/.bin/node tests/live-manga-workflow.mjs finish <run-dir>
```

Qwenエージェント→Gemma脚本→縦書き吹き出し→ブラウザで脚本確定→Kroma＋漫画LoRA強度0.6で3コマ生成→手動位置調整・保存・再読込→PNG/SVG/HTML出力→ギャラリー表示→編集再開を確認します。再生成を明示する場合だけ `render <run-dir> --regenerate` を使います。出力PNGは2000×2828で、元画像・過去の保存版も残ります。動作確認後も画面と画像の目視確認は必要です。

`repair` はCPU/RAMを使うIOPaintの実処理です。`repairs.json` は `[{"panelId":"p1-c1","regions":[{"x":10,"y":10,"width":100,"height":100}]}]` の形で、確認した元画像のピクセル座標を指定します。元画像保持とGUIからの漫画反映を検証します。`tests/progress-browser.mjs` は模擬ジョブの開始・失敗・完了、未保存台詞の保持、モバイルの進捗表示をモデル読込なしで検証します。

ローカル32Kコンテキスト用に、会話要約の出力枠・保持量を調整しています。要約時は巨大なツール一覧・通常のシステム指示を再送せず、会話履歴からチェックポイントを作ります。通常のエージェント実行では元の指示とツール一覧を維持します。作画待ちは `manga_status(detail:progress)`、台詞編集の応答は対象ページの吹き出しだけを返し、同じ脚本の再送を抑えます。

生成サーバーの初回起動は依存環境の取得で数分かかる場合があります。`media_service(start)` は接続を待ち、待機時間を超えても起動中なら `ready:false,status:starting` を返します。その場合は `media_status` で再確認します。`node_modules/.bin/node tests/generator-readiness.mjs` はこの案内表示を模擬APIで確認し、GPUを使いません。DSHを読み込むテストはNixOSの実行環境でlibstdc++が参照できる状態で実行してください。

ブラウザテストは Playwright Chromium または `CHROME_PATH` の Chrome を使います。NixOS の Chrome は自動検出します。DSH 統合テストでは `TEST_PYTHON` で Python 3.12 以降を指定できます。Gemma/Qwen は模擬 API、Krea は公式と同じ関数インターフェースのテスト用実装です。実機スモークテストは起動・入出力の機能確認であり、作品品質・長時間学習の品質・性能評価は含みません。

`tests/live-studios.mjs` は明示実行する実機テストです。`node_modules/.bin/node tests/live-studios.mjs krea` は512px画像1枚、`caption` はテスト画像3枚のキャプションと1ステップLoRA、`h3` は256px・124フレーム・1ステップの動画を生成します。テストLoRAは品質評価用ではありません。通常の `npm test` ではモデルをロードしません。

`node_modules/.bin/node tests/live-editor.mjs` は実モデルによる自動検出・IOPaint補完、手動モザイク、元画像保持、漫画への反映、履歴、動画の音声保持・シーク、モバイル表示を検証します。`bash python/run-edit.sh ../upstream/IOpaint/.venv/bin/python tests/live-sam2.py` は円だけの合成画像でSAM2輪郭抽出と3フレームの動画伝播を検証します。`TEST_EDITING=1 npm run test:dsh` は実DSHの編集ツールからPythonモザイク処理・漫画反映まで実行します。認識の取りこぼし率や長い動画での追跡品質を保証するテストではありません。

DSH は `0.2.1-alpha.1` と lockfile を固定しています。DSH 本体の依存監査は既知の指摘15件（moderate 6 / high 9）、このプラグイン単体の production 依存監査は0件でした。破壊的な一括アップグレードは実施していません。更新時は結合テストも実施してください。

参照・取得元：

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：`5badb15009ae1756c3afe0ae0cef1faafc290ccc`。プラグインと overlay で拡張。
- [Gemma Ortenzya GGUF](https://huggingface.co/llmfan46/gemma-4-Ortenzya-The-Creative-Wordsmith-31B-it-uncensored-heretic-GGUF)
- [Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B)
- [Krea 2 公式コード](https://github.com/krea-ai/krea-2)：`db3984fbc6e13b34c0064990fc2d95ac64d00058`
- [IOpaint](https://github.com/daraskme/IOpaint)：`b55b301919c492e7cc8169593f7ee6fd41a79e39`
- [mosaic_editor](https://github.com/daraskme/mosaic_editor)：`d4b5afa7d4307000dac50a5f707d4ee280d1e87a`

公式ソースは `upstream/`、追加実装は `manga-studio/`。第三者のコード・モデルには、それぞれの配布元のライセンスが適用されます。
