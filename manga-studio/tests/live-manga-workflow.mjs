// Explicit real-model workflow. Notify the user before author/render: GPU and RAM are used.
// Usage: node tests/live-manga-workflow.mjs author | approve/render/repair/finish <run-dir>
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {loadConfig,packageRoot} from '../src/config.js';
import {MangaService} from '../src/service.js';
import {startEditor} from '../src/editor-server.js';
import {Store,sessionKey} from '../src/store.js';
import {nativeSubprocess} from './native-subprocess.mjs';
import {letteringWarnings} from '../src/render.js';
import {localCompactionPolicy} from '../src/context-policy.js';

const phase=process.argv[2];assert(['author','approve','render','repair','finish'].includes(phase));
const regenerate=process.argv.includes('--regenerate');
const root=resolve(process.argv[3]||join(packageRoot,'.test-output','manga-workflow-'+Date.now()));await mkdir(root,{recursive:true});
const manifestPath=join(root,'run.json');
let run=phase==='author'?{root,createdAt:new Date().toISOString()}:JSON.parse(await readFile(manifestPath,'utf8'));
const save=()=>writeFile(manifestPath,JSON.stringify(run,null,2));
const config=phase==='author'?loadConfig():JSON.parse(await readFile(join(root,'config.json'),'utf8'));
if(phase==='author') {
  // Use the normal manga library so the completed test page remains in the real gallery.
  config.editorPort=0;config.gemma.maxTokens=4096;
  config.krea.model='kroma-v03-turbo';config.krea.preset='turbo8';
  config.krea.loras=[{id:'user/style/krea2_manga_style.safetensors',weight:0.6}];
  await writeFile(join(root,'config.json'),JSON.stringify(config,null,2));
  const patch=[
    {id:'llm-deepseek',disabled:true},{id:'web-search-deepseek',disabled:true},
    {id:'agent-default-model',config:{provider:'local-qwen',model:config.qwen.model}},
    {id:'llm-pi-ai',config:{providers:{'local-qwen':{api:'openai-completions',apiKeyEnv:'MANGA_TEST_KEY',baseURL:config.qwen.baseURL,compat:{supportsDeveloperRole:false,supportsStore:false,maxTokensField:'max_tokens'},models:[{id:config.qwen.model,contextWindow:32768,maxTokens:4096,input:['text']}]}}}},
    {insert:[{id:'local-runtime',name:join(packageRoot,'plugins/local-runtime/index.js')},{id:'manga-studio',name:join(packageRoot,'src/plugin.js'),config:{configFile:join(root,'config.json')}}]},
  ];
  await writeFile(join(root,'patch.json'),JSON.stringify(patch));await save();
}
// Apply the same local-model compaction policy to the headless test and to resumed runs.
const overlay=JSON.parse(await readFile(join(root,'patch.json'),'utf8')).filter(p=>!p.insert?.some(p=>p.id==='local-compaction')&&p.id!=='compaction-basic');
overlay.push({id:'compaction-basic',disabled:true},{insert:[{id:'local-compaction',name:join(packageRoot,'src/local-compaction.js'),config:{...localCompactionPolicy}}]});
await writeFile(join(root,'patch.json'),JSON.stringify(overlay));

async function agent(task) {
  const argv=[join(packageRoot,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','headless','--patch',join(root,'patch.json'),'--json',...(run.sessionId?['--session-id',run.sessionId]:[]),task];
  const child=spawn(process.execPath,argv,{cwd:resolve(packageRoot,'..'),env:{...process.env,DSH_HOME:join(packageRoot,'.dsh'),MANGA_TEST_KEY:'local'},stdio:['ignore','pipe','pipe']});
  const events=[];let buffer='',stdout='',stderr='';
  child.stdout.on('data',chunk=>{
    stdout+=chunk;buffer+=chunk;let index;
    while((index=buffer.indexOf('\n'))>=0) {
      const line=buffer.slice(0,index);buffer=buffer.slice(index+1);let event;try{event=JSON.parse(line);}catch{continue;}
      events.push(event);
      if(event.type==='session'){run.sessionId=event.sessionId;console.log('Session',event.sessionId);}
      if(event.type==='tool_call')console.log('Tool',event.tool);
      if(event.type==='tool_result'&&event.status!=='completed')console.log('Tool result',event.status,String(event.result).slice(0,250));
      if(event.type==='final')console.log('Agent turn finished');
    }
  });
  child.stderr.on('data',chunk=>stderr+=chunk);
  const timeout=setTimeout(()=>child.kill('SIGTERM'),900000);
  const exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});clearTimeout(timeout);
  const stamp=Date.now();await writeFile(join(root,phase+'-'+stamp+'-events.jsonl'),stdout);await writeFile(join(root,phase+'-'+stamp+'-stderr.log'),stderr);
  await writeFile(join(root,phase+'-events.jsonl'),stdout);await writeFile(join(root,phase+'-stderr.log'),stderr);await save();
  assert.equal(exitCode,0,stderr.slice(-1500));
  return events;
}

console.log('Run directory:',root);
if(phase==='author') {
  const events=await agent(`実際の漫画制作機能の動作確認として、このセッションで1ページのカラー漫画「雨上がりの忘れ物」を制作してください。今回は脚本と吹き出しまでです。
題材：雨がやんだ喫茶店で、店主が帰りかけた客へ赤い傘の忘れ物を知らせ、客が受け取り、最後に笑顔で店を出る。店主は35歳の男性、短い黒髪、白シャツと深緑のエプロン。客は28歳の女性、茶色のボブ、紺色のコート、ベージュの肩掛けバッグ。同じ外見・服・赤い傘を3コマで維持。
manga_create→manga_draft（Gemma、pageCount:1）の順に実行。Gemmaへのinstructionにはlayoutを「上大＋下2」、各コマの台詞は1本ずつ・18字以内、artPromptは英語で右上に吹き出し用の空きを残し文字を描かない、と指定する。台詞はGemmaが作った文を使う。
次にmanga_letterを1件ずつ使い全3本を縦書きに入力。台詞本文を省略・書換しない。revisionは各結果から更新して使い、同時に更新しない。bubbleはid,speaker,text,kind:speech,direction:vertical,fontSize:28,width:180,height:300。1コマ目x:770,y:60,tailX:740,tailY:370、2コマ目x:770,y:850,tailX:735,tailY:1160、3コマ目x:285,y:850,tailX:250,tailY:1160。
manga_open_editorを呼び、作成できたところまで報告して終了。作画、シェル、ファイル変更、確認質問は今回は不要です。利用者からこの動作確認自体は依頼済みです。`);
  for(const name of ['manga_create','manga_draft','manga_letter','manga_open_editor'])assert(events.some(e=>e.type==='tool_call'&&e.tool===name),name+' was not called');
  const store=new Store(config.dataDir);
  try {
    const p=store.get(sessionKey(run.sessionId));run.projectId=p.id;run.title=p.title;
    assert.equal(p.pages.length,1);assert.equal(p.pages[0].layout,'上大＋下2');
    assert.equal(p.pages[0].panels.length,3);assert.equal(p.pages[0].bubbles.length,3);
    assert.deepEqual(p.pages[0].bubbles.map(b=>b.text).sort(),p.pages[0].panels.flatMap(p=>p.dialogue.map(d=>d.text)).sort());
    assert(p.pages[0].bubbles.every(b=>b.direction==='vertical'));assert.deepEqual(letteringWarnings(p),[]);
    await writeFile(join(root,'authored-project.json'),JSON.stringify(p,null,2));
  }finally{store.close();}
  await save();console.log('PASS real Qwen → Gemma script → 3 vertical dialogue bubbles');
} else if(phase==='render') {
  const events=await agent(`同じ漫画セッションの制作を続けてください。試験担当が編集画面で脚本を確認し確定しました。manga_statusで状態を確認し、media_service(provider:krea,action:start)、media_status(provider:krea)で準備を確認してください。次にmanga_render(pageId:p1,model_id:kroma-v03-turbo,preset:turbo8,seed:52,loras:[{id:user/style/krea2_manga_style.safetensors,weight:0.6}],regenerate:${regenerate})で${regenerate?'全3コマを再作画。今回の再生成は試験担当の明示指示です。LoRA強度は小数0.6のまま渡してください。過去の0の指定は誤りです':'不足コマを作画'}。GPUとRAMの使用は利用者へ通知済みで、今回の3コマ生成は依頼済みです。生成は今回の1ジョブだけ送信してください。
起動準備中ならmedia_statusで待つ。生成完了までmanga_status(detail:progress)で確認し、失敗時は原因をそのまま報告。全コマcompletedになったらmedia_serviceでkreaをstopして解放し、manga_export、media_open_gallery、manga_open_editorを呼んで成果物を報告し終了してください。シェルや他作品は操作しない。`);
  for(const name of ['manga_render','manga_export','media_open_gallery'])assert(events.some(e=>e.type==='tool_call'&&e.tool===name),name+' was not called');
  const store=new Store(config.dataDir);
  try {
    const p=store.get(run.projectId);assert(p.pages[0].panels.every(p=>p.image));
    const jobs=store.jobs(p.id);assert.equal(jobs[0].status,'completed',JSON.stringify(jobs[0]));
    assert.equal(jobs[0].generation.model_id,'kroma-v03-turbo');
    assert.equal(jobs[0].generation.loras[0].weight,0.6);
    run.renderJob=jobs[0].id;await writeFile(join(root,'rendered-project.json'),JSON.stringify(p,null,2));
  }finally{store.close();}
  await save();console.log('PASS actual agent → Kroma 3 panels → SVG/HTML export');
} else {
  const service=new MangaService(config,nativeSubprocess),editor=await startEditor(service,0);
  const browser=await chromium.launch({headless:true,args:['--disable-gpu'],executablePath:process.env.CHROME_PATH||'/nix/store/i068vcjr9d1dk0ahikjpwgsncxbsslsf-google-chrome-153.0.8010.52/share/google/chrome/chrome'});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(editor.url(run.projectId));await page.locator('#title').filter({hasText:run.title}).waitFor();
    assert.equal(await page.locator('#canvas [data-bubble]').count(),3);
    if(phase==='repair') {
      // Explicit, visually chosen rectangles; never infer masks from arbitrary art.
      const repairs=JSON.parse(await readFile(join(root,'repairs.json'),'utf8'));
      run.repairs=[];
      for(const repair of repairs) {
        const asset=await service.edits.open(run.sessionId,{pageId:'p1',panelId:repair.panelId},AbortSignal.timeout(60000));
        const original=await readFile(service.edits.path(run.projectId,asset));
        await page.goto(editor.mediaUrl(run.projectId,asset.id));
        await page.waitForFunction(()=>document.querySelector('#dimensions').textContent.includes('元ファイル保持'));
        await page.locator('#tool').selectOption('rectangle');
        for(const region of repair.regions) {
          const box=await page.locator('#mask').boundingBox();
          await page.mouse.move(box.x+region.x/asset.width*box.width,box.y+region.y/asset.height*box.height);await page.mouse.down();
          await page.mouse.move(box.x+(region.x+region.width)/asset.width*box.width,box.y+(region.y+region.height)/asset.height*box.height);await page.mouse.up();
        }
        await page.locator('#inpaint').click();
        await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('処理が完了')||document.querySelector('#status').style.color==='rgb(170, 73, 58)',{},{timeout:300000});
        assert.match(await page.locator('#status').textContent(),/処理が完了/);
        await page.locator('#commit').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('コマへ反映'));
        const edited=service.edits.get(run.projectId,asset.id);
        assert.deepEqual(await readFile(service.edits.path(run.projectId,edited,'original')),original);
        run.repairs.push({panelId:repair.panelId,assetId:asset.id,path:service.edits.path(run.projectId,edited)});await save();
        await page.screenshot({path:join(root,repair.panelId+'-repaired.png'),fullPage:true});
        console.log('PASS GUI IOPaint mask → repair → comic commit; original retained:',repair.panelId);
      }
    } else if(phase==='approve') {
      await page.locator('#approve').click();await page.waitForFunction(()=>document.querySelector('#approve').disabled);
      assert(service.status(run.sessionId).project.approved);run.approved=true;
      await page.screenshot({path:join(root,'script-approved.png'),fullPage:true});
      console.log('PASS real editor script approval');
    } else {
      const before=service.status(run.sessionId).project;
      assert.equal(await page.locator('#canvas image').count(),3);
      const first=before.pages[0].bubbles[0];await page.locator('#selection').selectOption(first.id);
      await page.locator('#x').fill(String(first.x-8));await page.locator('#save').click();
      await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('保存しました'));
      await page.reload();await page.locator('#selection').selectOption(first.id);
      assert.equal(Number(await page.locator('#x').inputValue()),first.x-8);
      assert.equal(await page.locator('#text').inputValue(),first.text);
      assert.deepEqual(service.status(run.sessionId).project.pages[0].panels,before.pages[0].panels);
      const response=page.waitForResponse(r=>r.url().endsWith('/export')&&r.request().method()==='POST');await page.locator('#export').click();
      const exported=await(await response).json();assert.deepEqual(exported.warnings,[]);run.export=exported;
      await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('保存先：'));
      const event=page.waitForEvent('download');await page.locator('#downloadPng').click();run.png=join(exported.directory,'page-001.png');await(await event).saveAs(run.png);
      const png=await readFile(run.png);assert.equal(png.readUInt32BE(16),2000);assert.equal(png.readUInt32BE(20),2828);
      await page.screenshot({path:join(root,'completed-editor.png'),fullPage:true});
      await page.goto(editor.galleryUrl(run.projectId,run.sessionId));
      await page.locator(`#collections button[data-id="p-${run.projectId}"]`).click();await page.locator('#grid .card').first().click();
      await page.waitForFunction(()=>{const img=document.querySelector('#viewer img');return img?.complete&&img.naturalWidth>0;});
      await page.screenshot({path:join(root,'completed-gallery.png'),fullPage:true});
      await Promise.all([page.waitForURL(url=>url.pathname==='/'),page.locator('#edit').click()]);
      await page.waitForFunction(()=>document.querySelectorAll('#canvas image').length===3);
      assert.equal(await page.locator('#title').textContent(),run.title);
      run.finishedAt=new Date().toISOString();console.log('PASS manual edit/save/reload → PNG/SVG/HTML → gallery preview → resume editor');
      console.log('Finished PNG:',run.png);
    }
    assert.deepEqual(errors,[]);await save();
  }catch(error){
    for(const page of browser.contexts().flatMap(c=>c.pages())){console.error('GUI status:',await page.locator('#status').textContent().catch(()=>''));await page.screenshot({path:join(root,phase+'-failure.png'),fullPage:true}).catch(()=>{});}
    throw error;
  }finally{await browser.close();await editor.close();await service.close();}
}
