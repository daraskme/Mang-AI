import { open, readFile, unlink } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Schema from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { loadConfig, packageRoot } from './config.js';
import { MangaService } from './service.js';
import { startEditor } from './editor-server.js';
import { sessionKey } from './store.js';
import { registerStudioTools } from './studio-tools.js';
import { registerWorkflowGuides } from './workflow-guides.js';

export const name='manga-studio';
export const inject=['tools','systemPrompt','subprocess'];
export const Config=Schema.object({configFile:Schema.string()});
const string=(description,required=true)=>({type:'string',description,...required?{required:true}:{}});
const number=(description,required=true)=>({type:'integer',description,...required?{required:true}:{}});
const object=(description,required=true)=>({type:'object',additionalProperties:true,description,...required?{required:true}:{}});

async function lockRoot(root) {
  mkdirSync(root,{recursive:true});
  const path=join(root,'.studio.lock');
  for(let attempt=0;attempt<2;attempt++) {
    try {const fd=await open(path,'wx',0o600);await fd.writeFile(JSON.stringify({pid:process.pid}));await fd.close();return ()=>unlink(path);}
    catch(error) {
      if(error.code!=='EEXIST') throw error;
      const previous=JSON.parse(await readFile(path,'utf8'));
      try {process.kill(previous.pid,0);throw new Error('この dataDir は別の Manga Studio が使用中です');}
      catch(check) {if(check.code!=='ESRCH') throw check;await unlink(path);}
    }
  }
  throw new Error('Manga Studio の保存先を確保できませんでした');
}

/** Mount tools and the lettering editor on the normal DSH plugin lifecycle. */
export async function apply(ctx, options) {
  const config=loadConfig(options.configFile);
  const unlock=await lockRoot(config.dataDir);
  let service,editor;
  try {service=new MangaService(config,ctx.subprocess);editor=await startEditor(service,config.editorPort);}
  catch(error) {if(service) await service.close();await unlock();throw error;}
  ctx.effect(()=>async()=>{await editor.close();await service.close();await unlock();});
  ctx.inject(['webServer'],web=>{editor.allowFrameOrigin(`http://127.0.0.1:${web.webServer.port}`);editor.allowFrameOrigin(`http://localhost:${web.webServer.port}`);});
  const register=(toolName,description,parameters,execute)=>ctx.tools.register(defineTool({
    name:toolName,description,parameters,
    output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    execute:async(args,exec)=>{exec.signal.throwIfAborted();return execute(args,exec);},
    presentCall:()=>({card:'generic',title:description.split('。')[0]}),
    presentResult:(_args,result)=>({card:'generic',title:toolName,content:result.content}),
  }));
  registerWorkflowGuides(register);
  ctx.systemPrompt.section({name:'media-workflow-policy',order:10300,interpolate:false,text:'単独画像・動画・LoRA制作の着手時はmedia_workflow_guide(workflow:image/video/lora)でoverviewを読む。工程変更時に必要なsectionだけ読み、完了の証拠を確認して次へ進む。画像/動画はモデルとLoRAを選択→Gemmaでプロンプト保存→生成→確認・修正→仕上げ・保存。LoRAはfamilyとmode/triggerを固定→素材収集→UNSEEN Gemmaで画像キャプション→検査・TXT保存→学習→評価・登録。H3新規学習と動画全体のキャプションは未統合。H3をKrea学習で代用しない。手順や準備だけの依頼では生成・学習を開始しない。'});
  const mangaPolicy=await readFile(join(packageRoot,'docs/manga-production-policy.md'),'utf8');
  register('manga_workflow_guide','漫画制作の方針を読む。着手時・工程変更時に、設定→ページ配分→Gemmaの構造化プロンプト→指定LoRAで作画→修正と文字入力の順と担当を確認する。',{
    section:{type:'string',enum:['all','settings','pages','prompts','generate','revise','save','gpu'],description:'必要な工程だけ読む。省略時all'},
  },({section='all'})=>{
    const headings={settings:'1.',pages:'2.',prompts:'3.',generate:'4.',revise:'5.',save:'6.',gpu:'GPU'};
    return {policy:section==='all'?mangaPolicy:mangaPolicy.split(/\n(?=## )/).find(part=>part.startsWith(`## ${headings[section]}`)),source:'manga-studio/docs/manga-production-policy.md'};
  });
  ctx.systemPrompt.section({name:'manga-workflow-policy',order:10299,interpolate:false,text:'漫画制作の着手時は manga_workflow_guide を読む。司令塔がGemmaへ段階的に依頼する：全体の流れ・人物・背景と場所のつながりを保存→ページ数・場面配分・コマ割り→各ページの構造化プロンプト→利用者指定のキャラクター/Style LoRAでKrea生成→利用者の指摘に沿って改稿・再生成・IOPaint・専用文字ツール。指定LoRAを勝手に変更しない。台詞と地の文は基本縦書きで画像とは別入力。成果物と設定を保存して次工程へ進む。'});
  register('manga_create','現在の DSH セッション専用の漫画作品を作成する。既存作品は上書きしない。',{
    title:string('作品名'),brief:string('あらすじ・制作依頼'),characters:string('人物の外見・衣装・口調・関係の固定設定',false),style:string('共通画風（英語推奨）',false),
  },(args,exec)=>({project:service.create(exec.agent.id,args),editorUrl:editor.url(sessionKey(exec.agent.id))}));
  register('manga_status','現在のセッションの漫画・台詞・生成ジョブを読む。再開時は全文、作画の進捗確認はdetail:progressを使う。',{detail:{type:'string',enum:['full','progress'],description:'省略時full。progressは長い脚本を繰り返し返さない'}},(args,exec)=>{
    const result=service.status(exec.agent.id);
    if(args.detail==='progress'){
      const p=result.project;result.project={id:p.id,revision:p.revision,approved:p.approved,pages:p.pages.map(page=>({id:page.id,panels:page.panels.map(panel=>({id:panel.id,image:panel.image}))}))};
      result.jobs=result.jobs.map(job=>({id:job.id,pageId:job.pageId,status:job.status,completed:job.completed,total:job.panels.length,error:job.error}));
    }
    return {...result,editorUrl:editor.url(sessionKey(exec.agent.id))};
  });
  register('manga_draft','日本語創作用 Gemma に人物設定と現脚本を渡して漫画脚本を作る。既存脚本の置換時は利用者の改稿指示が必要。',{
    instruction:string('今回の執筆・改稿指示'),pageCount:number('ページ数 1〜32'),revision:number('manga_status が返した現在の revision'),
  },(args,exec)=>service.draft(exec.agent.id,args,exec.signal));
  register('manga_plan','Gemmaに段階的に漫画を制作させる。初回・中断再開はall：設定→ページ配分→各ページの作画指示を個別に保存。修正はsettings/pages/promptsを指定。上流変更は下流を要更新にする。',{
    stage:{type:'string',enum:['all','settings','pages','prompts'],required:true},instruction:string('利用者の制作・修正指示を正確に転記。ページとコマを取り違えない。指定LoRAや保持する設定も伝える'),revision:number('直前の結果のrevisionをそのまま指定。自分で足さない'),pageCount:number('指定があれば作品全体のページ数1〜32。未指定ならGemmaが配分',false),pageId:string('promptsではp1などが必須。他工程は不要',false),
  },async(args,exec)=>{
    const result=await service.plan(exec.agent.id,args,exec.signal),p=result.project;
    const pending=p.production.pages?.pages.find(page=>!p.production.prompts?.[page.id]);
    const next=p.production.pages?(pending?'prompts':'lettering_review'):'pages';
    return {revision:p.revision,completedStage:args.stage,next,nextTool:next==='lettering_review'?'manga_open_editor':'manga_plan',nextArguments:next==='lettering_review'?{}:{stage:next,revision:p.revision,...pending?{pageId:pending.id}:{}},project:{id:p.id,title:p.title,revision:p.revision},settingsSummary:p.production.settings.summary,pages:p.production.pages?.pages.map(page=>({id:page.id,layout:page.layout,purpose:page.purpose,promptReady:!!p.production.prompts?.[page.id]})),note:next==='lettering_review'?'設定・ページ配分・全ページのプロンプトを保存済みです。追加の修正指示がなければmanga_planは再実行不要。計画までの依頼ならここで完了を報告してください。':'設定と脚本の詳細は保存済み。Gemmaは必要な資料を自動で読みます。必要ならmanga_statusで詳細を確認できます。'};
  });
  register('manga_set_script','確認した漫画脚本 JSON を保存する。pages 配列、layout、purpose、panels（action,artPrompt,dialogue）が必要。画像と文字を分離する。',{
    script:object('脚本 JSON。コマ割りは manga_draft と同じ形式'),revision:number('現在の revision'),
  },(args,exec)=>({project:service.setScript(exec.agent.id,args)}));
  register('manga_letter','専用の吹き出し・文字入力ツール。漫画の台詞は基本縦書き（上から下、列は右から左）。作画プロンプトへ文字を含めない。verticalizeはこのページの通常・思考の吹き出しを一括で縦書きにする。座標は1000×1414。',{
    revision:number('現在の revision'),pageId:string('p1 など'),action:{type:'string',enum:['upsert','delete','verticalize'],required:true},id:string('delete 時の吹き出しID',false),
    bubble:{type:'object',additionalProperties:false,properties:{
      id:string('英数字の吹き出しID'),text:string('画像に重ねる日本語本文'),speaker:string('話者',false),kind:{type:'string',enum:['speech','thought','caption','text'],required:true},shape:{type:'string',enum:['auto','art','overlay'],description:'autoは空吹き出し生成済みコマで文字だけ表示。artは常に画像内の枠へ文字だけ、overlayは編集可能な枠と尾を描く。画像の吹き出しに合わせて位置とサイズを調整'},direction:{type:'string',enum:['vertical','horizontal'],description:'新規は省略すると縦書き。更新時の省略は現在の方向を保持。通常はvertical、横書きが必要な箇所だけhorizontal'},
      ...Object.fromEntries(['x','y','width','height','fontSize','tailX','tailY'].map(k=>[k,{type:'number',required:true,description:k==='fontSize'?'12〜100。通常26〜34':`ページ上の ${k}`}]))},description:'upsert時に必要。x,y は左上。尾の先端が tailX,tailY'},
  },(args,exec)=>{const result=service.letter(exec.agent.id,args),p=result.project;return {project:{id:p.id,revision:p.revision},pageId:args.pageId,bubbles:p.pages.find(page=>page.id===args.pageId).bubbles,warnings:result.warnings};});
  register('manga_open_editor','このセッションの吹き出し・文字編集画面を開くための URL を返す。脚本の確認・確定もこの画面で行う。',{},(_args,exec)=>{
    service.status(exec.agent.id);return {url:editor.url(sessionKey(exec.agent.id))};
  });
  register('manga_render','確定済みの1ページをローカル Krea 2 公式 Python で作画する。GPUキューへ入れ、すぐジョブIDを返す。既存画像は既定で再生成しない。',{
    pageId:string('p1 など'),seed:number('0〜2147483647',false),regenerate:{type:'boolean',description:'明示的な再作画時だけ true'},
    balloonMode:{type:'string',enum:['generated','overlay'],description:'既定generated：絵と空の吹き出しを一緒に描き、文字だけ別入力。overlay：絵には枠を描かず専用ツールで枠も重ねる。生成後に文字位置を確認'},
    model_id:string('media_status の KreaモデルID。Kroma は kroma-v03-turbo',false),preset:{type:'string',enum:['turbo8','fast4','raw'],description:'Kromaはturbo8を指定'},
    loras:{type:'array',description:'追加するLoRA。省略時は既定、空配列でなし',items:{type:'object',additionalProperties:false,properties:{id:string('LoRA ID'),weight:{type:'number',description:'通常0〜1。0.6など小数も指定可能'},enabled:{type:'boolean'}}}},
  },async(args,exec)=>({job:await service.render(exec.agent.id,args),poll:{tool:'manga_status',arguments:{detail:'progress'}},note:'漫画専用ジョブです。状態はmanga_statusで確認します。'}));
  register('manga_history','このセッションの保存履歴を新しい順に最大100件表示する。',{},(_args,exec)=>({revisions:service.store.history(sessionKey(exec.agent.id))}));
  register('manga_restore','利用者が指定した保存版を、このセッションの新しい版として復元する。現在の版も履歴に残る。',{
    targetRevision:number('復元する保存版'),revision:number('現在の revision'),
  },(args,exec)=>({project:service.store.restore(sessionKey(exec.agent.id),args.targetRevision,args.revision)}));
  register('manga_cancel','このセッションの作画ジョブを中止する。完了済みの画像は残す。',{jobId:string('ジョブID')},(args,exec)=>({job:service.cancel(exec.agent.id,args.jobId)}));
  register('manga_export','ページSVG・閲覧/印刷用HTML・編集JSONをセッション配下の新しいフォルダへ書き出す。',{},(_args,exec)=>service.export(exec.agent.id));
  registerStudioTools(register,service.studios);
  register('gpu_status','常駐A1、現在のGPU工程、待ち行列とRAM/VRAMの空きを確認する。大規模モデルの読込前や待機時に使う。',{},()=>service.studios.gpuStatus());
  register('media_model_catalog','Krea/H3のモデル・LoRA一覧と、このセッションの選択を読む。起動中の環境をrefreshで再検査する。',{
    provider:{type:'string',enum:['krea','h3','longvideo'],required:true},refresh:{type:'boolean'},
  },async(a,e)=>({...await service.studios.models.catalog(a.provider,a),selection:service.studios.models.selected(e.agent.id,a.provider)}));
  register('media_model_select','利用者が指定したモデルとLoRAの組合せをこのセッションへ保存する。漫画・画像・動画の次の生成で使う。LoRA強度と用途を保持する。',{
    provider:{type:'string',enum:['krea','h3','longvideo'],required:true},model:string('一覧のモデルID'),loras:{type:'array',items:{type:'object',additionalProperties:false,properties:{id:string('一覧のLoRA ID'),weight:{type:'number',required:true},role:{type:'string',enum:['character','style','other']},enabled:{type:'boolean'}}}},
  },(a,e)=>service.studios.models.select(e.agent.id,a));
  ctx.systemPrompt.section({name:'model-roles',order:10298,interpolate:false,text:'司令塔はAgents A1 4B Q8で、Mang-AI起動中は常駐する。漫画の制作はmanga_plan、単体画像・動画・長尺ショットの自然言語プロンプトはmedia_promptでGemma 4へ依頼し、保存した結果を生成ツールへ渡す。コーディングはlist_subagent_modelsでmanga-coder / qwen3.8-flash-next-q8-strataを確認し、subagentのproviderとmodelで指定する。Qwenへ漫画の通常プロンプト作成を回さない。GPU工程は共通キューが管理する。Gemmaの成果物を保存→解放→Krea/H3生成→解放の順。高負荷のツールを呼ぶ前に利用者へ通知する。gpu_statusがメモリ待ちなら必要量を伝え、利用者によるVM停止を待つ。他アプリやVMを停止しない。'});
  ctx.systemPrompt.section({name:'resource-notice',order:20001,interpolate:false,text:'利用者の希望：GPUやRAMへ大きな負荷をかける生成・学習・大規模モデル読込の前に、実行する内容と負荷の見込みを短く日本語で知らせる。既に依頼されている処理は、通知のためだけに承認を再要求しない。負荷の数値が不明なら推測値を断定しない。'});
  ctx.systemPrompt.section({name:'media-startup',order:10304,interpolate:false,text:'media_service / media_status がready:false,status:startingなら生成環境は起動準備中。media_statusが準備完了を返すまで生成・再起動を繰り返さず、このツールで待つ。依存環境の初回取得は数分かかる場合がある。漫画の作画待ちにはmanga_status(detail:progress)を使う。'});
  ctx.systemPrompt.section({name:'manga-vertical-lettering',order:10301,interpolate:false,text:'漫画の日本語の台詞は基本縦書き。manga_letterの新規入力はdirection:verticalを使い、上から下・右の列から左の列へ読む。改行は次の左列へ送る。横書きは利用者が指定した箇所や横組みの看板等に限る。既存ページの台詞を縦書きへ変更する指示にはmanga_letter(action:verticalize)を使える。文字や画像を再生成せず、縦組みで溢れた場合は吹き出しの高さ・幅・文字サイズを調整する。'});
  ctx.systemPrompt.section({name:'manga-generated-balloons',order:10302,interpolate:false,text:'漫画の作画は既定でballoonMode:generated。Kreaが絵と空の吹き出しを描き、日本語はmanga_letterで後から重ねる。生成前に台詞の本数・話者・配置を確定する。生成後は絵の空吹き出しを確認し、文字のx/y/width/height/fontSizeを合わせる。shape:autoは生成済みの枠を使い二重の枠を描かない。自動判定が合わないときshape:artで文字だけ、枠を別描画するならoverlay。枠や尾は画像に含まれるため文字ツールでは動かせない。旧画像へは自動で空吹き出しを追加しない。'});
  register('media_open_gallery','データセット、全セッションの制作中の漫画、生成画像・動画を閲覧するメディアギャラリーを開く。キャプション確認と編集再開ができる。',{},(_a,e)=>({url:editor.galleryUrl(sessionKey(e.agent.id),e.agent.id)}));
  ctx.on('webserver/index-inject',table=>table.push({kind:'global',name:'__MANGAI_GALLERY__',value:editor.galleryUrl(sessionKey('gallery'),'gallery')}));
  ctx.on('webserver/index-inject',table=>table.push({kind:'global',name:'__MANGAI_PROGRESS__',value:editor.progressUrl(sessionKey('gallery'),'gallery')}));
  ctx.on('webserver/index-inject',table=>table.push({kind:'global',name:'__MANGAI_WORKSPACE__',value:editor.workspaceUrl(sessionKey('gallery'),'gallery')}));
  register('media_open_generator','画像・動画・長尺動画の生成画面を開く。モデル選択、手動生成、ショット計画、進捗確認、Hires・アップスケールができる。',{},(_a,e)=>({url:editor.generationUrl(sessionKey(e.agent.id),e.agent.id)}));
  ctx.systemPrompt.section({name:'longvideo',order:10303,interpolate:false,text:'長尺動画は media_service(provider=longvideo,action=start) の後、h3_longvideo_plan で共通設定＋空行で区切った各ショットを検査し、h3_longvideo_generate で生成する。既定はDaSiWa Turbo v3、0.4MP、8steps。仕上げは0.8MP、導入済み潜在upscalerを使える。台詞は二重引用符、環境音は各ショットに明記する。音の指定がないショットは無音になる。media_jobで完了と保存パスを確認する。media_open_generatorは手動生成GUI。画像のHiresはmedia_upscaleで4step・denoise0.25が既定。H3の単発生成は8step、確認用はturbo4。merged Turboモデルに加速LoRAを重ねない。'});
  register('media_open_editor','IOPaint 修正・モザイクの編集画面を開く。path に画像/MP4の絶対パス、または pageId/panelId に漫画のコマを指定する。元ファイルを保持する。',{
    path:string('画像またはMP4の絶対パス',false),pageId:string('漫画のページID',false),panelId:string('漫画のコマID',false),
  },async(a,e)=>{const asset=await service.edits.open(e.agent.id,a,e.signal);return {asset,url:editor.mediaUrl(sessionKey(e.agent.id),asset.id)};});
  register('media_edit','IOPaint補完またはモザイクを処理キューへ入れる。regionsは画像ピクセル。autoDetectはmosaic_editorの検出を使う。動画はモザイクに対応。',{
    assetId:string('media_open_editor の asset.id'),revision:number('現在のasset.revision'),mode:{type:'string',enum:['inpaint','mosaic','detect'],required:true},
    regions:{type:'array',items:{type:'object',additionalProperties:false,properties:{x:number('左'),y:number('上'),width:number('幅'),height:number('高さ')}}},mask:string('PNG data URL。GUI手描きマスクも使用可能',false),autoDetect:{type:'boolean'},categories:{type:'array',items:{type:'string',enum:['penis','vagina','nipples','mosaic']}},threshold:{type:'number'},refine:{type:'boolean'},margin:number('マスク拡張px',false),block:number('モザイクサイズ。0で自動',false),time:{type:'number',description:'動画から自動選択するフレームの秒数'},startSeconds:{type:'number'},endSeconds:{type:'number'},
  },(a,e)=>({job:service.edits.enqueue(sessionKey(e.agent.id),a)}));
  register('media_edit_status','画像修正・モザイクの結果、進捗、編集履歴を読む。',{assetId:string('編集対象ID'),jobId:string('処理ID',false)},(a,e)=>({asset:service.edits.get(sessionKey(e.agent.id),a.assetId),...a.jobId?{job:service.edits.get(sessionKey(e.agent.id),a.jobId,'edit-job')}:{}}));
  register('media_edit_cancel','このセッションの修正・モザイク処理を中止する。',{jobId:string('処理ID')},(a,e)=>({job:service.edits.cancel(sessionKey(e.agent.id),a.jobId)}));
  register('media_edit_commit','編集結果を元の漫画コマへ反映する。独立画像・動画なら保存パスを返す。元データと編集履歴は残る。',{assetId:string('編集対象ID'),revision:number('現在のasset.revision')},(a,e)=>service.edits.commit(sessionKey(e.agent.id),a));
  ctx.systemPrompt.section({name:'media-edits',order:10302,interpolate:false,text:'画像修正・モザイクは media_open_editor で対象を開く。手動編集は返されたGUI URLを渡す。自動処理は media_edit の regions または autoDetect を使い、media_edit_status で完了を確認して media_edit_commit で漫画へ反映する。IOPaintは静止画の選択範囲をLaMaで補完する。モザイクは画像とMP4に対応し、動画音声を保持する。自動検出の対象なし・失敗を完成扱いしない。'});
  ctx.systemPrompt.section({name:'local-studios',order:10301,interpolate:false,text:
    'ローカル生成には media_service でサーバーを起動し media_status で準備状態を確認する。Krea 2 は画像、MiniMax H3 は動画と音声。生成は krea_generate / h3_generate、進捗は media_job。GPUメモリが必要な切替では待機中の Studio を media_service stop で停止できる。利用者の別アプリを無断で終了しない。LoRA は caption_open で画像フォルダと用途・トリガーを指定し、caption_generate で画像認識に基づく自然言語キャプションを作る。caption_status で誤認識を確認し caption_edit、caption_save で保存。lora_prepare の検査後、利用者が依頼した学習を lora_run start で開始し status で完了を確認する。lora_install で Krea 2 に登録し、返されたトリガーと media_status の LoRA ID を生成時に使う。準備だけ、未開始、失敗、途中のジョブを完了と呼ばない。'
  });
  ctx.systemPrompt.section({name:'manga-studio',order:10300,interpolate:false,text:
    '漫画制作では司令塔が工程とツール操作を担当する。manga_create後、初回はmanga_plan(stage:all)でGemmaへ設定→ページ配分→各ページの作画指示を段階的に依頼する。指定ページ数はpageCount、制作依頼はinstructionへ正確に渡す。中断後のallは保存済み工程から再開する。修正はsettings/pages/promptsで対象を指定し、上流を変更したら下流を更新する。revisionは結果の値をそのまま指定し自分で加算しない。再開・編集前はmanga_status。1セッション1作品、1ページ2〜4コマ。dialogueは台詞候補で、画像には文字が出ない。全台詞・地の文をmanga_letterで入力する。文字の溢れは位置・サイズ・改行で解決し、無断で意味を削らない。manga_open_editorで脚本を確認・確定してからmanga_render。利用者指定のモデルとLoRAを使用する。作画完了はmanga_statusのjobsで確認し、最後はmanga_export。既存のmanga_draftは以前の脚本との互換用。'
  });
}
