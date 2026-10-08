import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { exists, atomicWrite, EXTENSIONS } from './storage.mjs';
import { buildPrompt, cleanCaption } from './prompts.mjs';
const APP_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MODEL_ROOT=path.join(APP_ROOT,'models/caption');
export const ENGINE_DEFAULTS={binary:path.join(APP_ROOT,'runtime/llama-server'),model:MODEL_ROOT+'/UNSEEN_Gemma_4_26B_NSFW_Q4_K_M.gguf',mmproj:MODEL_ROOT+'/mmproj-gemma4-vision-f16.gguf',port:8099,gpuLayers:99,context:8192,imageTokens:1120,cpuVision:false};
export async function detectBinary() {
  const dirs=(process.env.PATH||'').split(path.delimiter);
  for(const dir of dirs) if(await exists(path.join(dir,'llama-server')))return path.join(dir,'llama-server');
  for(const dir of (await fs.readdir('/nix/store').catch(()=>[])).filter(s=>/llama-cpp/.test(s) && !s.endsWith('.drv')).reverse()) {
    const p=path.join('/nix/store',dir,'bin/llama-server');if(await exists(p))return p;
  }
  return '';
}
export function engineConfig(input) {
  const c={...ENGINE_DEFAULTS,...input};
  for(const k of ['binary','model','mmproj']) if(typeof c[k]!=='string' || c[k].length>4096)throw new Error('モデルパスが不正です');
  for(const [k,min,max] of [['port',1024,65535],['gpuLayers',0,999],['context',2048,65536],['imageTokens',70,4096]]) {
    c[k]=Number(c[k]);if(!Number.isInteger(c[k]) || c[k]<min || c[k]>max)throw new Error(`${k}の値が不正です`);
  }
  c.cpuVision=!!c.cpuVision;return c;
}
export class Engine {
  constructor(root) {this.root=root;this.child=null;this.logs=[];this.config={...ENGINE_DEFAULTS};this.key=randomBytes(24).toString('hex');this.inUse=0;this.lastUsed=Date.now();this.ready=false;
    this.idleTimer=setInterval(()=>{if(process.env.MANGAI_GPU_STATE&&this.child&&this.ready&&!this.inUse&&Date.now()-this.lastUsed>90000)this.stop();},15000);this.idleTimer.unref();
  }
  async init() { const stored=JSON.parse(await fs.readFile(path.join(this.root,'engine.json'),'utf8').catch(()=> '{}'));this.config=engineConfig(stored);if(!this.config.binary)this.config.binary=await detectBinary(); }
  headers() {return this.child?{Authorization:'Bearer '+this.key}:{};}
  base() {return `http://127.0.0.1:${this.config.port}`;}
  log(text) {this.logs.push(...text.trim().split('\n'));if(this.logs.length>160)this.logs.splice(0,this.logs.length-160);}
  async status() {
    let health='offline',model='',error='';
    try {
      const r=await fetch(this.base()+'/health',{headers:this.headers(),signal:AbortSignal.timeout(1500)});
      if(r.ok) {health='ready';const m=await fetch(this.base()+'/v1/models',{headers:this.headers(),signal:AbortSignal.timeout(1500)}).then(r=>r.json());model=m.data?.[0]?.id||'';}
      else {health=r.status===503?'loading':'error';error=`HTTP ${r.status}`;}
    }catch(e){error=e.message;}
    this.ready=health==='ready';if(health==='offline'&&this.child)health='loading';
    return {health,model,managed:!!this.child,config:this.config,logs:this.logs.slice(-60),error};
  }
  async configure(input) {if(this.child)throw new Error('モデルを停止してから接続設定を変更してください');this.config=engineConfig(input);await atomicWrite(path.join(this.root,'engine.json'),JSON.stringify(this.config,null,2));}
  async start() {
    if(this.child)throw new Error('モデルはすでに起動中です');
    if((await this.status()).health!=='offline')throw new Error('このポートは使用中です。既存サーバーを接続確認するかポートを変えてください');
    const c=this.config;
    for(const key of ['binary','model','mmproj']) if(!await exists(c[key]))throw new Error(`${key} が見つかりません: ${c[key]}`);
    const args=['--model',c.model,'--mmproj',c.mmproj,'--host','127.0.0.1','--port',String(c.port),'--ctx-size',String(c.context),'--n-gpu-layers',String(c.gpuLayers),'--parallel','1','--batch-size','512','--ubatch-size','256','--image-max-tokens',String(c.imageTokens),'--jinja','--reasoning-format','deepseek','--api-key',this.key];
    if(c.cpuVision)args.push('--no-mmproj-offload');
    this.logs=[];this.log('Starting llama-server');
    const managed=!!process.env.MANGAI_GPU_STATE;
    if(managed&&(!process.env.MANGAI_GPU_PYTHON||!process.env.MANGAI_GPU_RUNNER))throw Error('共通GPUキューの実行設定がありません');
    this.lastUsed=Date.now();this.ready=false;
    const child=spawn(managed?process.env.MANGAI_GPU_PYTHON:c.binary,managed?[process.env.MANGAI_GPU_RUNNER,'caption','--',c.binary,...args]:args,{stdio:['ignore','pipe','pipe'],env:{...process.env,LD_LIBRARY_PATH:['/run/opengl-driver/lib',process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')}});
    this.child=child;
    child.stdout.on('data',b=>this.log(b.toString()));child.stderr.on('data',b=>this.log(b.toString()));
    child.on('error',e=>{this.log(e.message);if(this.child===child)this.child=null;});
    child.on('exit',(code,signal)=>{this.log(`Server exited: ${code ?? signal}`);if(this.child===child)this.child=null;});
  }
  stop() {if(!this.child)throw new Error('このGUIから起動したモデルだけ停止できます');const child=this.child;child.kill('SIGTERM');setTimeout(()=>{if(this.child===child)child.kill('SIGKILL');},5000).unref();}
  async caption(file,settings,metadata,signal) {
    const size=(await fs.stat(file)).size;
    if(size>40*1024*1024)throw new Error('画像が40MBを超えています。縮小版を使用してください');
    const image=await fs.readFile(file);
    const prompt=buildPrompt(settings,metadata);
    const res=await fetch(this.base()+'/v1/chat/completions',{
      method:'POST',headers:{'Content-Type':'application/json',...this.headers()},
      signal:AbortSignal.any([signal,AbortSignal.timeout(settings.timeout*1000)]),
      body:JSON.stringify({messages:[{role:'user',content:[{type:'image_url',image_url:{url:`data:${EXTENSIONS.get(path.extname(file).toLowerCase())};base64,${image.toString('base64')}`}},{type:'text',text:prompt}]}],temperature:settings.temperature,top_p:0.9,max_tokens:settings.maxTokens,stream:false,reasoning_format:'deepseek',chat_template_kwargs:{enable_thinking:false,thinking:false}})
    });
    if(!res.ok)throw new Error(`llama-server HTTP ${res.status}: ${(await res.text()).slice(0,500)}`);
    const data=await res.json();return {caption:cleanCaption(data.choices?.[0],settings.trigger),prompt};
  }
}
export class Jobs {
  constructor(workspace,engine) {this.workspace=workspace;this.engine=engine;this.current=null;this.abort=null;this.starting=false;}
  active() {return this.starting || this.current?.state==='running' || this.current?.state==='stopping';}
  async start(ids,overwrite=false) {
    if(this.active())throw new Error('生成中のジョブがあります');
    this.starting=true;
    try {
    const p=this.workspace.require();
    const items=[...new Set(ids)].map(id=>this.workspace.item(id)).filter(i=>overwrite || !i.caption.trim());
    if(!items.length)throw new Error('生成対象がありません。未生成画像を選ぶか「既存も再生成」を有効にしてください');
    if((await this.engine.status()).health!=='ready')throw new Error('モデルを起動し、接続状態が「準備完了」になるまでお待ちください');
    const settings=structuredClone(p.settings), job={state:'running',total:items.length,done:0,failed:0,current:'',startedAt:Date.now(),errors:[]};
    this.current=job;this.abort=new AbortController();
    void this.run(items,settings,job,this.abort.signal).catch(e=>{job.state='error';job.errors.push({error:e.message});});return job;
    } finally {this.starting=false;}
  }
  async run(items,settings,job,signal) {
    this.engine.inUse++;
    try {
    for(const i of items) {
      if(signal.aborted)break;
      job.current=i.relative;i.status='generating';i.error='';
      const before=i.caption, metadata=i.metadata;
      try {
        const result=await this.engine.caption(await this.workspace.imagePath(i.id),settings,metadata,signal);
        if(signal.aborted)break;
        await this.workspace.serialized(async()=>{
          if(i.caption!==before || i.metadata!==metadata)throw new Error('生成中に編集されたため結果を反映しませんでした。必要なら再生成してください');
          if(before)await atomicWrite(path.join(this.workspace.root,'draft-history',this.workspace.project.id,i.id+'-'+Date.now()+'.json'),JSON.stringify({caption:before,prompt:i.prompt},null,2));
          i.caption=result.caption;i.prompt=result.prompt;i.reviewed=false;i.generatedAt=new Date().toISOString();i.status='ready';await this.workspace.persist();
        });
      }catch(e){
        if(signal.aborted)break;
        i.error=e.name==='TimeoutError'?'生成がタイムアウトしました。待機時間を増やして再試行してください。':e.message;i.status='error';job.failed++;job.errors.push({file:i.relative,error:i.error});
      }finally {if(i.status==='generating')i.status=i.caption?'ready':'empty';}
      job.done++;
    }
    job.current='';job.state=signal.aborted?'cancelled':'completed';job.finishedAt=Date.now();
    await this.workspace.serialized(()=>this.workspace.persist());
    } finally {this.engine.inUse--;this.engine.lastUsed=Date.now();if(process.env.MANGAI_GPU_STATE&&this.engine.child&&!this.engine.inUse)this.engine.stop();}
  }
  stop() {if(this.active()){this.current.state='stopping';this.abort.abort();}}
}
