// Actual published DSH + native tool dispatch + actual Python process; no model weights.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { packageRoot } from '../src/config.js';
import { Store } from '../src/store.js';
import { config, tempRoot, script, bubble, png } from './fixtures.js';

const root=await tempRoot('dsh'),repo=join(root,'krea');await mkdir(repo);
let python=process.env.TEST_PYTHON;
if(!python){try{const dirs=await readdir('/nix/store');const dir=dirs.find(d=>/-python3-3\.12\.\d+$/.test(d));if(dir)python=join('/nix/store',dir,'bin/python3');}catch{/* Use an explicit TEST_PYTHON on other platforms. */}}
assert(python,'TEST_PYTHON must name a Python 3.11+ executable');
await writeFile(join(repo,'inference.py'),"def _pipeline(checkpoint):\n    assert checkpoint == 'oss_turbo'\n    return None, None, None\n");
await writeFile(join(repo,'sampling.py'),`import base64\nfrom pathlib import Path\nclass Image:\n    def save(self, file): Path(file).write_bytes(base64.b64decode('${png.toString('base64')}'))\ndef sample(*args, **kwargs): return [Image()]\n`);
await writeFile(join(repo,'weights'),'fixture');
let step=0,gemmaCalls=0,results=[],serverError,editAsset,editJob;
const testEditing=process.env.TEST_EDITING==='1';
const testService=process.env.TEST_SERVICE==='1';
assert(!(testEditing&&testService),'Run the editing and service smoke tests separately');
function unpack(message){if(!message)return null;try{return JSON.parse(typeof message.content==='string'?message.content:message.content.map(b=>b.text||'').join(''));}catch{return null;}}
const server=createServer(async(req,res)=>{
  try{
    let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);
    if(input.model==='fake-gemma'){
      gemmaCalls++;assert.equal(input.stream,false);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(script)}}]}));return;
    }
    assert.equal(input.model,'fake-qwen');
    if(!input.tools){
      if(input.stream){res.setHeader('Content-Type','text/event-stream');res.write(`data: ${JSON.stringify({id:'title',object:'chat.completion.chunk',created:1,model:'fake-qwen',choices:[{index:0,delta:{role:'assistant',content:'漫画制作テスト'},finish_reason:'stop'}]})}\n\n`);res.end('data: [DONE]\n\n');}
      else{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'漫画制作テスト'}}]}));}
      return;
    }
    assert.equal(input.stream,true);
    assert(input.tools.some(t=>t.function?.name==='manga_letter'));
    for(const name of ['krea_generate','h3_generate','media_job','caption_open','caption_generate','caption_save','lora_prepare','lora_run','lora_install','media_open_editor','media_edit','media_edit_status','media_edit_cancel','media_edit_commit'])assert(input.tools.some(t=>t.function?.name===name),`Missing DSH tool: ${name}`);
    const last=input.messages.filter(m=>m.role==='tool').at(-1),value=unpack(last);
    if(last)results.push(last);
    let call;
    if(step===0)call=['manga_create',{title:'DSH 統合試験',brief:'ローカル制作の検証'}];
    else if(step===1)call=['manga_draft',{instruction:'1ページにする',pageCount:1,revision:1}];
    else if(step===2)call=['manga_letter',{pageId:'p1',revision:2,action:'upsert',bubble}];
    else if(step===3)call=['manga_open_editor',{}];
    else if(step===4){
      assert(value?.url,`editor URL missing: ${JSON.stringify(last)}`);const url=new URL(value.url),hash=new URLSearchParams(url.hash.slice(1));
      const approved=await fetch(`${url.origin}/api/${hash.get('project')}/approve`,{method:'POST',headers:{Authorization:`Bearer ${hash.get('token')}`,'Content-Type':'application/json'},body:JSON.stringify({revision:3})});
      assert.equal(approved.status,200);call=['manga_render',{pageId:'p1',seed:12}];
    } else if(step===5)call=['manga_status',{}];
    else if(step===6){
      if(value?.jobs?.[0]?.status==='completed')call=['manga_export',{}];
      else {assert(!['failed','interrupted','canceled'].includes(value?.jobs?.[0]?.status),JSON.stringify(value));step--;await new Promise(resolve=>setTimeout(resolve,100));call=['manga_status',{}];}
    }
    else if(testEditing&&step===7)call=['media_open_editor',{pageId:'p1',panelId:'p1-c1'}];
    else if(testEditing&&step===8){assert(value?.asset?.id,JSON.stringify(last));editAsset=value.asset.id;call=['media_edit',{assetId:editAsset,revision:value.asset.revision,mode:'mosaic',regions:[{x:0,y:0,width:1,height:1}],block:2}];}
    else if(testEditing&&step===9){assert(value?.job?.id,JSON.stringify(last));editJob=value.job.id;call=['media_edit_status',{assetId:editAsset,jobId:editJob}];}
    else if(testEditing&&step===10){
      assert(value?.job,JSON.stringify(last));
      if(value.job.status==='completed')call=['media_edit_commit',{assetId:editAsset,revision:value.asset.revision}];
      else{assert(['running','queued'].includes(value.job.status),JSON.stringify(value));step--;await new Promise(resolve=>setTimeout(resolve,100));call=['media_edit_status',{assetId:editAsset,jobId:editJob}];}
    }
    else if(testEditing&&step===11)assert(value?.outputPath,JSON.stringify(last));
    else if(testService&&step===7)call=['media_service',{provider:'krea',action:'start'}];
    else if(testService&&step===8){assert.equal(value?.action,'start',JSON.stringify(last));call=['media_service',{provider:'krea',action:'stop'}];}
    else if(testService&&step===9)assert.equal(value?.action,'stop',JSON.stringify(last));
    res.setHeader('Content-Type','text/event-stream');
    const content=call?{role:'assistant',tool_calls:[{index:0,id:`call_${step}_${results.length}`,type:'function',function:{name:call[0],arguments:JSON.stringify(call[1])}}]}:{role:'assistant',content:'DSH_MANGA_SMOKE_OK'};
    const envelope={id:'test',object:'chat.completion.chunk',created:1,model:'fake-qwen'};
    res.write(`data: ${JSON.stringify({...envelope,choices:[{index:0,delta:content,finish_reason:null}]})}\n\n`);
    res.write(`data: ${JSON.stringify({...envelope,choices:[{index:0,delta:{},finish_reason:call?'tool_calls':'stop'}]})}\n\n`);res.end('data: [DONE]\n\n');step++;
  }catch(error){serverError=error;res.statusCode=500;res.end(JSON.stringify({error:{message:error.message}}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const c=config(join(root,'data'));c.gemma.baseURL=`http://127.0.0.1:${server.address().port}/v1`;c.gemma.model='fake-gemma';c.krea.repo=repo;c.krea.python=python;c.krea.weights=join(repo,'weights');
await writeFile(join(root,'config.json'),JSON.stringify(c));
const overlay=[
  {id:'agent-default-model',config:{provider:'manga-test',model:'fake-qwen'}},
  {id:'llm-pi-ai',config:{providers:{'manga-test':{api:'openai-completions',apiKeyEnv:'MANGA_TEST_KEY',baseURL:c.gemma.baseURL,compat:{supportsDeveloperRole:false,supportsStore:false,maxTokensField:'max_tokens'},models:[{id:'fake-qwen',contextWindow:32768,maxTokens:2048,input:['text']}]}}}},
  {insert:[{id:'manga-studio',name:join(packageRoot,'src/plugin.js'),config:{configFile:join(root,'config.json')}}]},
];
await writeFile(join(root,'overlay.yml'),JSON.stringify(overlay));
const require=createRequire(import.meta.url),bin=join(dirname(require.resolve('@deepseek-ai/dsh/package.json')),'lib/bin.js');
const child=spawn(process.execPath,[bin,'--profile','headless','--patch',join(root,'overlay.yml'),'--json','Run the manga tool test.'],{cwd:root,env:{...process.env,DSH_HOME:join(root,'dsh'),MANGA_TEST_KEY:'local'},stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
const timer=setTimeout(()=>child.kill('SIGTERM'),60000);
try{
  const code=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
  clearTimeout(timer);
  if(serverError){console.error(stderr.slice(-12000));throw serverError;}
  assert.equal(code,0,`DSH exited ${code}\n${stderr}\n${stdout}`);assert(stdout.includes('DSH_MANGA_SMOKE_OK'),stdout);
  assert.equal(gemmaCalls,1);const db=new Store(c.dataDir);
  try{const row=db.db.prepare('SELECT body FROM projects').get(),p=JSON.parse(row.body);assert.equal(p.pages[0].bubbles[0].text,bubble.text);assert(p.pages[0].panels.every(p=>p.image));assert.equal(db.jobs(p.id)[0].status,'completed');}finally{db.close();}
  await writeFile(join(packageRoot,'.test-output/dsh-smoke.jsonl'),stdout);
  console.log('PASS DSH integration: Qwen tool calls → Gemma script → lettering tool → editor approval → managed Krea Python → exported SVG/HTML');
  if(testEditing)console.log('PASS real DSH media_open_editor → managed mosaic Python → status → comic commit');
  if(testService)console.log('PASS real DSH managed Krea service start and stop (no model load)');
}finally{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGTERM');await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
