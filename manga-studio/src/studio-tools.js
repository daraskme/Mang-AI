const string=(description,required=true)=>({type:'string',description,...required?{required:true}:{}});
const integer=(description,required=false)=>({type:'integer',description,...required?{required:true}:{}});
const object=(description)=>({type:'object',additionalProperties:true,description});
const ids={type:'array',items:{type:'string'},description:'対象の画像ID。省略で全画像'};
const provider={type:'string',enum:['krea','h3','caption','longvideo'],required:true};
const loras={type:'array',items:{type:'object',additionalProperties:true},description:'media_status の LoRA 一覧から指定。Krea: {id,weight,enabled}、H3: {path,weight,enabled}'};

export function registerStudioTools(register,studios) {
  register('media_library','整理済みの既存LoRAとデータセットを検索する。返されたloraIdを生成に使い、画像データセットのpathをcaption_openに渡す。中間チェックポイントはtrainingRun内に保管される。',{
    family:{type:'string',enum:['krea2','h3']},kind:{type:'string',enum:['lora','dataset','training-run']},query:string('名前・分類による絞り込み',false),offset:integer('先頭位置'),limit:integer('1〜100、既定40'),
  },a=>studios.library(a));
  const longArgs={prompt:string('最初の段落は共通設定。空行で区切った次の段落から1段落1ショット。台詞は二重引用符'),model:string('media_status(longvideo) のチェックポイント名',false),shot_seconds:{type:'number',description:'1ショット1〜15秒、既定8。全体120秒まで'},megapixels:{type:'number',description:'0.2〜2MP。確認用0.4、仕上げ0.8'},steps:integer('蒸留済みモデルでは通常8'),seed:integer('固定seed'),resolution:{type:'string',enum:['16:9','9:16','4:3','3:4','1:1','21:9','9:21']},firstFramePath:string('先頭画像の絶対パス',false),anchor:string('外見・場所の固定情報',false),character_memory:string('人物の記憶・共通情報',false),latent_upscale:string('media_status に表示される潜在アップスケーラ名、既定off',false),latent_upscale_scale:{type:'number'},upscale:{type:'string',enum:['off','lanczos']},upscale_target_short_edge:integer('画素拡大後の短辺サイズ'),shift_video:{type:'number'},shift_audio:{type:'number'}};
  longArgs.loras=loras;
  register('h3_longvideo_plan','H3長尺動画の段落構成と予定尺を検査する。GPU生成は行わない。',longArgs,a=>studios.planLongVideo(a));
  register('h3_longvideo_generate','Smite79 H3-LongVideos で複数ショットを接続して動画と音声を生成する。蒸留済みDaSiWa v3を既定とし、追加の加速LoRAは重ねない。',longArgs,(a,e)=>studios.generate(e.agent.id,'longvideo',a,e.signal));
  register('media_upscale','このセッションで生成完了した画像・動画を拡大する。Kreaは低denoiseのHiresリファイン。H3は画素アップスケールで音声を維持する。',{
    id:string('生成済みmedia_jobのid'),scale:{type:'number',description:'Krea 1〜2、H3 1/2/3/4'},method:string('Krea: lanczos/auto/neural、H3: lanczos/realesrgan_x2plus/seedvr2_3b。対応モデルの導入が必要',false),refine_steps:integer('Krea Hires、既定4'),denoise_strength:{type:'number',description:'Krea Hires、既定0.25'},prompt:string('Kreaのリファイン指示。省略で元の指示',false),
  },(a,e)=>studios.upscale(e.agent.id,a,e.signal));
  register('media_status','ローカル Krea 2・H3・キャプション環境の準備状態と利用可能なモデルを取得する。',{provider},(a,e)=>studios.status(a.provider,e.signal));
  register('media_service','指定 Studio を起動、または待機中の Studio を停止してVRAMを解放する。実行中ジョブがある場合は停止しない。',{provider,action:{type:'string',enum:['start','stop'],required:true}},(a,e)=>studios.control(a.provider,a.action,e.signal));
  register('krea_generate','既存の Krea 2 Python 環境で画像を生成し、このセッションにジョブIDを保存する。文字・吹き出しは漫画の専用ツールへ渡す。',{
    prompt:string('自然言語の画像生成指示、4000文字以内'),width:integer('16の倍数'),height:integer('16の倍数'),seed:integer('乱数seed'),steps:integer('生成ステップ数'),preset:{type:'string',enum:['turbo8','fast4','raw']},model_id:string('media_status のモデルID',false),loras,
  },(a,e)=>studios.generate(e.agent.id,'krea',a,e.signal));
  register('h3_generate','MiniMax H3 で動画・音声を生成し、すぐジョブIDを返す。画像から動画を作る場合は firstFramePath に画像パスを指定できる。',{
    memory_profile:{type:'string',enum:['auto','resident','shared','low_memory'],description:'Qwenとの併用はshared（TEをINT4）。生成モデルだけを使う場合はresident（TEをINT8）'},
    prompt:string('動き、被写体、カメラ、音などの生成指示'),model:string('media_status のモデル相対パス。既定 MiniMax-H3',false),width:integer('出力幅'),height:integer('出力高さ'),frames:integer('124〜345。24fps、17k+5へ調整される'),seed:integer('乱数seed'),steps:integer('ステップ数'),preset:{type:'string',enum:['balanced','quality','turbo8','turbo4']},attention:{type:'string',enum:['sage','sdpa']},latent_refine:object('Hires: {enabled:true,model:一覧の潜在upscaler,scale:1.5,strength:0.18,steps:4}。width/heightは仕上がり寸法'),firstFramePath:string('先頭画像の絶対パス',false),lastFramePath:string('末尾画像の絶対パス',false),loras,
  },(a,e)=>studios.generate(e.agent.id,'h3',a,e.signal));
  register('media_job','このセッションから投入した画像・動画ジョブの進捗・結果URLを取得、または中止する。',{id:string('krea_generate / h3_generate の id'),action:{type:'string',enum:['status','cancel']}},(a,e)=>studios.job(e.agent.id,a.id,a.action,e.signal));
  register('caption_open','Krea 2 LoRA 用の画像フォルダを開き、このセッションへ紐付ける。元画像は変更しない。',{
    folder:string('画像フォルダの絶対パス'),recursive:{type:'boolean'},settings:object('mode: character/concept/style、trigger、classNoun、concept、learn、describe、language: en/ja、extra など。省略時は保存済み設定'),
  },(a,e)=>studios.captionOpen(e.agent.id,a,e.signal));
  register('caption_status','画像ID・自然言語キャプション・生成進捗をページ単位で読む。内容のない画像説明を推測しない。',{offset:integer('先頭位置、既定0'),limit:integer('1〜100、既定30')},(a,e)=>studios.captionStatus(e.agent.id,a,e.signal));
  register('caption_generate','画像認識 Gemma で自然言語キャプションを一括生成する。既存文章は既定で保持。モデル未起動時は起動し loading を返すため、ready 後に再実行する。',{
    ids,overwrite:{type:'boolean',description:'利用者が既存キャプションの再生成を指示した場合だけ true'},
  },(a,e)=>studios.captionAction(e.agent.id,'generate',a,e.signal));
  register('caption_edit','画像の自然言語キャプションを下書き保存する。台詞や見えない要素を勝手に足さず、トリガーを保つ。',{
    id:string('caption_status の画像ID'),caption:string('キャプション本文',false),reviewed:{type:'boolean',description:'内容を確認した場合のみ true'},metadata:string('画像の既知情報',false),
  },(a,e)=>studios.captionAction(e.agent.id,'edit',a,e.signal));
  register('caption_save','下書きを画像と同名の .txt へ保存する。既存 .txt はバックアップし、外部変更がある場合は上書きしない。',{ids},(a,e)=>studios.captionAction(e.agent.id,'save',a,e.signal));
  register('caption_cancel','現在のセッションのキャプション生成を中止する。保存済みの下書きは残す。',{},(a,e)=>studios.captionAction(e.agent.id,'stop',a,e.signal));
  register('lora_prepare','キャプション・トリガー・GPU・RAWモデルを検査し、画像数と用途から LoRA 学習設定を作る。返された設定と警告を確認して lora_run で開始する。',{
    ids,config:object('推奨設定の上書き。steps,rank,alpha,resolution,learningRate,batchSize,saveEvery,fp8,blocksToSwap 等'),
  },(a,e)=>studios.prepareTraining(e.agent.id,a,e.signal));
  register('lora_run','このセッションで用意した Krea 2 LoRA 学習を開始・進捗取得・停止する。start は利用者が学習を依頼した場合に使用する。',{
    id:string('lora_prepare の id'),action:{type:'string',enum:['start','status','stop'],required:true},
  },(a,e)=>studios.training(e.agent.id,a.id,a.action,e.signal));
  register('lora_install','完了した LoRA を Krea 2 の LoRA フォルダへコピーし、生成から使えるようにする。同名ファイルは上書きしない。',{
    id:string('lora_prepare の id'),name:string('登録名。英数字・ハイフン・アンダースコア'),artifact:string('学習成果物の絶対パス。省略時は最終モデル',false),
  },(a,e)=>studios.installLora(e.agent.id,a,e.signal));
}
