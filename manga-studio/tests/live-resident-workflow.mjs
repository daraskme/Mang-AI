// Explicit real-model integration check. Notify before running: uses A1/Gemma/Krea.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {loadConfig,packageRoot} from '../src/config.js';
import {MangaService} from '../src/service.js';
import {Store,sessionKey} from '../src/store.js';
import {nativeSubprocess} from './native-subprocess.mjs';
import {LAYOUTS} from '../src/model.js';

const phase=process.argv[2]||'plan';assert(['plan','render'].includes(phase));
const root=resolve(process.argv[3]||join(packageRoot,'.test-output','resident-workflow-'+Date.now()));await mkdir(root,{recursive:true});
if(phase==='plan'){
  const config=loadConfig();config.dataDir=join(root,'projects');config.editorPort=0;config.gemma.maxTokens=6000;
  await writeFile(join(root,'config.json'),JSON.stringify(config,null,2));
  const patch=[{id:'llm-deepseek',disabled:true},{id:'web-search-deepseek',disabled:true},{id:'agent-default-model',config:{provider:'resident-test',model:config.agent.model}},{id:'llm-pi-ai',config:{providers:{'resident-test':{api:'openai-completions',apiKeyEnv:'MANGA_TEST_KEY',baseURL:config.agent.baseURL,compat:{supportsDeveloperRole:false,supportsStore:false,maxTokensField:'max_tokens'},models:[{id:config.agent.model,contextWindow:65536,maxTokens:8192,input:['text']}]}}}},{insert:[{id:'manga-studio',name:join(packageRoot,'src/plugin.js'),config:{configFile:join(root,'config.json')}}]}];
  await writeFile(join(root,'patch.json'),JSON.stringify(patch));
  const prompt='動作確認として、全体で1ページ、2コマの漫画「出発の朝」の制作計画とプロンプトまで作成してください。人物は成人の遥と湊。遥は家に残り、湊は白い鞄を持って外へ出ます。1コマ目はリビングで短く会話、2コマ目は同じ家の玄関で遥が湊を見送ります。2つの場所のつながり、衣装、鞄、玄関の内外の位置を固定します。漫画制作方針のsettingsをmanga_workflow_guideで読み、manga_create後にmanga_plan(stage:all,pageCount:1,revision:1)を1回実行してください。instructionはこの依頼をそのまま正確に渡し「全体で1ページ2コマ、layoutは縦2（上大）」と明記。ツールがGemmaへ3工程を順番に依頼して保存します。今回は画像生成・文字入力・シェル・追加質問は不要です。必要な補完は提案に留め、終了時に制作できた工程を短く報告してください。';
  const events=[],child=spawn(process.execPath,[join(packageRoot,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','headless','--patch',join(root,'patch.json'),'--json',prompt],{cwd:resolve(packageRoot,'..'),env:{...process.env,DSH_HOME:join(root,'dsh'),MANGA_TEST_KEY:'local'},stdio:['ignore','pipe','pipe']});
  let output='',error='',session,buffer='';
  child.stdout.on('data',b=>{output+=b;buffer+=b;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){let e;try{e=JSON.parse(line);}catch{continue;}events.push(e);if(e.type==='session')session=e.sessionId;if(e.type==='tool_call')console.log('Tool',e.tool,JSON.stringify(e.input).slice(0,1000));if(e.type==='tool_result'&&e.status==='error')console.log('Tool error',e.result);}});
  child.stderr.on('data',b=>error+=b);const timer=setTimeout(()=>child.kill('SIGTERM'),900000);
  const code=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject);});clearTimeout(timer);
  await writeFile(join(root,'events.jsonl'),output);await writeFile(join(root,'stderr.log'),error);await writeFile(join(root,'run.json'),JSON.stringify({root,session,code},null,2));
  assert.equal(code,0,error.slice(-1500));assert(session);
  const store=new Store(config.dataDir);try{const project=store.get(sessionKey(session));assert(project.production.settings);assert.equal(project.production.pages.pages.length,1);assert(project.production.prompts.p1);assert.equal(project.pages[0].panels.length,2);console.log(JSON.stringify({root,session,revision:project.revision,stages:['settings','pages','prompts']}));}finally{store.close();}
}else{
  const run=JSON.parse(await readFile(join(root,'run.json'),'utf8')),config=JSON.parse(await readFile(join(root,'config.json'),'utf8')),service=new MangaService(config,nativeSubprocess);
  try{
    let project=service.status(run.session).project;
    const page=project.pages[0];
    for(const [i,panel]of page.panels.entries())for(const [j,line]of panel.dialogue.entries()){
      const [x,y,w,h]=LAYOUTS[page.layout][i];
      project=service.letter(run.session,{revision:project.revision,pageId:page.id,action:'upsert',bubble:{id:`test-${i}-${j}`,kind:'speech',direction:'vertical',speaker:line.speaker,text:line.text,x:x+w-190-j*180,y:y+25,width:165,height:Math.min(300,h-40),fontSize:26,tailX:x+w-210-j*180,tailY:y+Math.min(320,h-20)}}).project;
    }
    project=service.approve(project.id,project.revision);
    const job=await service.render(run.session,{pageId:'p1',seed:80,model_id:'kroma-v03-turbo',preset:'turbo8',loras:[{id:'user/style/krea2_manga_style.safetensors',weight:0.6}]});
    console.log('Render',job.id);await service.queue;const completed=service.store.getJob(job.id);assert.equal(completed.status,'completed',completed.error);
    const result=await service.export(run.session);await writeFile(join(root,'render-result.json'),JSON.stringify({job:completed,result},null,2));console.log(JSON.stringify({root,result}));
  }finally{await service.close();}
}
