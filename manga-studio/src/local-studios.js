import { setTimeout as delay } from 'node:timers/promises';
import { copyFile, mkdir, readFile, stat, writeFile, rename, unlink } from 'node:fs/promises';
import { constants, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { basename, extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sessionKey } from './store.js';
import { planLongVideo, submitLongVideo, longVideoJob } from './longvideo.js';

const units={krea:'krea2-studio.service',h3:'h3studio.service',caption:'mang-ai-caption.service',longvideo:'mang-ai-longvideo.service'};
const active=s=>['queued','running','loading','generating','stopping','cancelling'].includes(s);

/** Adapts the user's installed studios without replacing their inference code. */
export class LocalStudios {
  constructor(config,store,subprocess) {
    this.config=config;this.store=store;this.subprocess=subprocess;this.tail=Promise.resolve();
    store.db.exec('CREATE TABLE IF NOT EXISTS integrations (id TEXT PRIMARY KEY, session TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL)');
  }
  save(session,kind,value,id=randomUUID()) {
    this.store.db.prepare('INSERT OR REPLACE INTO integrations VALUES (?,?,?,?)').run(id,sessionKey(session),kind,JSON.stringify(value));return id;
  }
  owned(session,id,kind) {
    const row=this.store.db.prepare('SELECT * FROM integrations WHERE id=? AND session=?').get(id,sessionKey(session));
    if(!row || kind && row.kind!==kind)throw new Error('このセッションの記録が見つかりません');
    return {kind:row.kind,...JSON.parse(row.body)};
  }
  serial(fn) {const next=this.tail.then(fn);this.tail=next.catch(()=>{});return next;}
  base(provider) {
    if(!units[provider])throw new Error('provider は krea、h3、caption、longvideo です');
    const url=new URL(this.config[provider]?.baseURL);
    if(url.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password)throw new Error('生成 Studio はローカル HTTP URL を指定してください');
    return url.origin;
  }
  async request(provider,path,{body,signal,raw=false,timeoutMs=15000}={}) {
    const base=this.base(provider),url=new URL(path,base);
    if(url.origin!==base)throw new Error('別ホストの生成結果は取得できません');
    signal=signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
    const headers={};
    if(provider==='caption') {
      const html=await fetch(base+'/',{signal,redirect:'error'}).then(r=>{if(!r.ok)throw new Error(`Caption HTTP ${r.status}`);return r.text();});
      const token=html.match(/name="studio-token" content="([a-f0-9]+)"/)?.[1];
      if(!token)throw new Error('Caption Studio の接続情報を取得できません');
      headers['x-studio-token']=token;
    }
    if(body && !(body instanceof FormData))headers['Content-Type']='application/json';
    const response=await fetch(url,{method:body===undefined?'GET':'POST',headers,body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body),signal,redirect:'error'});
    if(!response.ok)throw new Error(`${provider} HTTP ${response.status}: ${(await response.text()).slice(0,1500)}`);
    return raw?response:response.json();
  }
  async status(provider,signal) {
    const readiness=await this.waitReady(provider,signal,this.config[provider]?.statusWaitMs??10000);
    if(!readiness.ready)return readiness;
    if(provider==='longvideo')return {url:this.base(provider),queue:await this.request(provider,'/queue',{signal}),models:(await this.request(provider,'/object_info/UNETLoader',{signal})).UNETLoader.input.required.unet_name[0],loras:(await this.request(provider,'/object_info/LoraLoaderModelOnly',{signal})).LoraLoaderModelOnly.input.required.lora_name[0],options:(await this.request(provider,'/object_info/H3LongVideos',{signal})).H3LongVideos.input};
    if(provider==='krea')return {url:this.base(provider),state:await this.request(provider,'/api/state',{signal}),models:await this.request(provider,'/api/models',{signal}),loras:await this.request(provider,'/api/loras',{signal})};
    if(provider==='h3')return {url:this.base(provider),state:await this.request(provider,'/api/status',{signal}),models:await this.request(provider,'/api/inventory',{signal}),options:await this.request(provider,'/api/generation/options',{signal})};
    return {url:this.base(provider),engine:await this.request(provider,'/api/engine/status',{signal}),training:await this.request(provider,'/api/training/status',{signal})};
  }
  async waitReady(provider,signal,waitMs=45000) {
    const path={krea:'/health',h3:'/api/status',caption:'/api/engine/status',longvideo:'/queue'}[provider];
    this.base(provider);const deadline=Date.now()+waitMs;
    do {
      signal?.throwIfAborted();
      try{await this.request(provider,path,{signal,timeoutMs:1500});return {provider,url:this.base(provider),ready:true,status:'ready'};}
      catch(error){signal?.throwIfAborted();if(!['ECONNREFUSED','ECONNRESET','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT'].includes(error.cause?.code)&&error.name!=='TimeoutError')throw error;}
      if(Date.now()>=deadline)break;
      await delay(Math.min(1000,Math.max(1,deadline-Date.now())),undefined,{signal});
    }while(Date.now()<=deadline);
    const h=this.subprocess.spawn({argv:['systemctl','--user','show','--property=ActiveState','--value',units[provider]],cwd:this.store.root,stdio:{stdin:'ignore',stdout:{maxBytes:1024},stderr:{maxBytes:1024}},signal,graceMs:3000});
    const result=await h.done;await h.waitForExit();
    const state=h.collected.stdout?.readFrom(0)?.text.trim();
    const starting=result.exitCode===0&&['active','activating','reloading'].includes(state);
    return {provider,url:this.base(provider),ready:false,status:starting?'starting':'offline',note:starting?'生成環境は起動準備中です。初回は依存環境の取得に時間がかかります。media_status で再確認してください。再起動や生成の連続送信は不要です。':'生成環境へ接続できません。media_service の start で起動してください。'};
  }
  async control(provider,action,signal) {
    this.base(provider);
    if(!['start','stop'].includes(action))throw new Error('action は start / stop です');
    if(action==='stop') {
      try {
      if(provider==='krea') {
        const s=await this.request(provider,'/api/state',{signal});
        if(s.active_job_id||s.queue_length||active(s.status))throw new Error('Krea は処理中です。先にジョブを停止してください');
      } else if(provider==='h3') {
        const jobs=await this.request(provider,'/api/jobs?limit=500',{signal});
        const status=await this.request(provider,'/api/status',{signal});
        if(jobs.some(j=>active(j.status)) || active(status.engine?.runtime?.state))throw new Error('H3 は処理中です');
      } else if(provider==='longvideo') {
        const q=await this.request(provider,'/queue',{signal});
        if(q.queue_running.length||q.queue_pending.length)throw new Error('長尺動画の処理中です');
      } else {
        const s=await this.request(provider,'/api/state',{signal}),t=await this.request(provider,'/api/training/status',{signal});
        if(active(s.job?.state)||active(t?.state))throw new Error('キャプション生成または学習が実行中です');
      }
      } catch(error) {
        if(error.cause?.code!=='ECONNREFUSED')throw error;
        // An already stopped service is safe to stop again via systemd.
      }
    }
    const handle=this.subprocess.spawn({argv:['systemctl','--user',action,units[provider]],cwd:this.store.root,stdio:{stdin:'ignore',stdout:{maxBytes:1024},stderr:{maxBytes:4096}},signal,graceMs:3000});
    const result=await handle.done;await handle.waitForExit();
    if(result.exitCode!==0)throw new Error(`systemctl ${action} が失敗しました: ${handle.collected.stderr?.readFrom(0)?.text||result.exitCode}`);
    if(action==='start') {
      const readiness=await this.waitReady(provider,signal,this.config[provider]?.startupWaitMs??45000);
      return {...readiness,action,note:readiness.ready?'サーバーの接続準備ができました。media_status でモデルを確認できます。':readiness.note};
    }
    return {provider,action,url:this.base(provider),note:'停止しました。'};
  }
  async generate(session,provider,args,signal) {
    if(provider==='longvideo')return submitLongVideo(this,session,args,signal);
    if(!['krea','h3'].includes(provider))throw new Error('画像は krea、動画は h3 または longvideo です');
    let body;
    if(provider==='krea')body={model_id:this.config.krea.model,preset:this.config.krea.preset||'turbo8',attention_backend:'sdpa',...args};
    else {
      const {firstFramePath,lastFramePath,...rest}=args;
      const model=rest.model||this.config.h3.model;
      const merged=model!=='MiniMax-H3',preset=rest.preset||(model.includes('Hybrid-v2')?'quality':'turbo8');
      const steps=rest.steps??({turbo8:8,turbo4:4,quality:24,balanced:20}[preset]);
      const loras=rest.loras||[];
      if(!merged&&preset.startsWith('turbo')&&!loras.some(l=>l.enabled!==false&&/turbo|lightx2v|pdd|fasth3|taomate/i.test(l.path))) {
        const inventory=await this.request('h3','/api/inventory',{signal});
        const needle=preset==='turbo4'?'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors':'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors';
        const entries=inventory.loras||[];
        const found=entries.find(x=>(x.path||x.name)?.endsWith(needle));
        if(!found)throw Error(`${preset}用のLoRAがありません。media_status で確認してください`);
        loras.push({path:found.path||found.name,weight:1,enabled:true});
      }
      body={model,memory_profile:this.config.h3.memoryProfile||'shared',width:960,height:544,frames:124,attention:'sage',...rest,preset,steps,loras};
      for(const [key,file] of [['first_frame',firstFramePath],['last_frame',lastFramePath]])if(file) {
        const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[extname(file).toLowerCase()];
        if(!mime || (await stat(file)).size>32*1024*1024)throw new Error('参照画像は32MB以下の PNG/JPEG/WebP です');
        const form=new FormData();form.append('file',new Blob([await readFile(file)],{type:mime}),basename(file));
        body[key]=(await this.request('h3','/api/uploads',{body:form,signal,timeoutMs:60000})).id;
      }
    }
    const job=await this.request(provider,provider==='krea'?'/api/generate':'/api/jobs',{body,signal});
    const remoteId=job.job_id||job.id;
    if(typeof remoteId!=='string')throw new Error('生成サーバーがジョブIDを返しませんでした');
    const id=this.save(session,'media',{provider,remoteId,request:body});
    return {id,provider,remoteId,job};
  }
  async job(session,id,action='status',signal) {
    const ref=this.owned(session,id,'media');
    if(!['status','cancel'].includes(action))throw new Error('action は status / cancel です');
    const job=ref.provider==='longvideo'?await longVideoJob(this,ref,action,signal):await this.request(ref.provider,`/api/jobs/${encodeURIComponent(ref.remoteId)}${action==='cancel'?'/cancel':''}`,{body:action==='cancel'?{}:undefined,signal});
    const url=job.result?.image_url||job.output_url;
    let outputPath;
    if(action==='status' && job.status==='completed' && url) {
      const allowed=ref.provider==='krea'?url.startsWith('/outputs/'):ref.provider==='longvideo'?url.startsWith('/view?'):url.startsWith(`/api/jobs/${ref.remoteId}/file/`);
      if(!allowed)throw new Error('生成結果の URL が不正です');
      const dir=join(this.store.directory(sessionKey(session)),'media');await mkdir(dir,{recursive:true});
      outputPath=join(dir,`${id}.${ref.provider==='krea'?'png':'mp4'}`);
      if(!(await stat(outputPath).catch(e=>{if(e.code!=='ENOENT')throw e;return null;}))) {
        const temporary=outputPath+'.'+randomUUID()+'.part';
        try {
          const response=await this.request(ref.provider,url,{raw:true,signal,timeoutMs:120000});
          await pipeline(Readable.fromWeb(response.body),createWriteStream(temporary,{flags:'wx'}),{signal});
          await rename(temporary,outputPath);
        }catch(error){await unlink(temporary).catch(()=>{});throw error;}
      }
    }
    return {id,provider:ref.provider,job,...url?{outputUrl:new URL(url,this.base(ref.provider)).href}:{},...outputPath?{outputPath}:{}};
  }
  planLongVideo(args) {return planLongVideo(args);}
  async library({family,kind,query='',offset=0,limit=40}={}) {
    if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)throw Error('offset >= 0、limit は1〜100です');
    const catalog=JSON.parse(await readFile(this.config.library,'utf8'));
    const items=catalog.items.filter(x=>(!family||x.family===family)&&(!kind||x.kind===kind)&&(!query||`${x.name} ${x.category}`.toLowerCase().includes(query.toLowerCase())));
    return {total:items.length,offset,items:items.slice(offset,offset+limit)};
  }
  async upscale(session,{id,...args},signal) {
    const ref=this.owned(session,id,'media');
    if(ref.provider==='longvideo')throw Error('長尺動画は生成時の upscale / latent_upscale を指定してください');
    const original=await this.job(session,id,'status',signal);
    if(original.job.status!=='completed')throw Error('生成が完了したジョブを指定してください');
    const body=ref.provider==='krea'?{scale:1.5,method:'lanczos',refine_steps:4,denoise_strength:0.25,...args,source_image:original.job.result.image_url}:{method:'lanczos',scale:2,...args,source:{job_id:ref.remoteId}};
    const job=await this.request(ref.provider,ref.provider==='krea'?'/api/upscale':'/api/jobs/upscale',{body,signal});
    const remoteId=job.job_id||job.id;
    if(typeof remoteId!=='string')throw Error('アップスケールのジョブIDがありません');
    return {id:this.save(session,'media',{provider:ref.provider,remoteId,request:body,parent:id}),provider:ref.provider,job};
  }
  async renderKrea(request,signal,onJob=()=>{},onProgress=()=>{}) {
    const submitted=await this.request('krea','/api/generate',{body:{...request,output:undefined,id:undefined,model_id:request.model_id||this.config.krea.model,preset:request.preset||this.config.krea.preset||'turbo8',attention_backend:'sdpa',loras:request.loras??this.config.krea.loras??[]},signal});
    const id=submitted.job_id;if(!id)throw new Error('Krea job_id がありません');onJob(id);
    try {
      while(true) {
        signal.throwIfAborted();
        const job=await this.request('krea',`/api/jobs/${encodeURIComponent(id)}`,{signal});
        onProgress(job);
        if(job.status==='completed') {
          const url=job.result?.image_url;
          if(!url?.startsWith('/outputs/'))throw new Error('Krea の画像 URL が不正です');
          const response=await this.request('krea',url,{raw:true,signal,timeoutMs:60000});
          const bytes=Buffer.from(await response.arrayBuffer());
          if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Krea の結果が PNG ではありません');
          await writeFile(request.output,bytes,{flag:'wx'});return job;
        }
        if(['failed','cancelled','canceled'].includes(job.status))throw new Error(job.error?.message||job.error||`Krea: ${job.status}`);
        await delay(this.config.krea.pollMs||1000,undefined,{signal});
      }
    } catch(error) {
      if(signal.aborted)await this.request('krea',`/api/jobs/${encodeURIComponent(id)}/cancel`,{body:{}}).catch(()=>{});
      throw error;
    }
  }
  captionRef(session) {return `caption-${sessionKey(session)}`;}
  async captionProject(session,signal) {
    const saved=this.owned(session,this.captionRef(session),'caption');
    const state=await this.request('caption','/api/state',{signal});
    if(state.project?.id!==saved.projectId)throw new Error('Caption Studio の画像フォルダが変わりました。caption_open でこのセッションのフォルダを開き直してください');
    return state;
  }
  async captionOpen(session,{folder,recursive=true,settings},signal) {
    return this.serial(async()=>{
      const p=await this.request('caption','/api/open',{body:{folder,recursive},signal,timeoutMs:120000});
      this.save(session,'caption',{projectId:p.id,folder:p.source},this.captionRef(session));
      if(settings)await this.request('caption','/api/settings',{body:{...p.settings,...settings,expectedProjectId:p.id},signal});
      return {projectId:p.id,folder:p.source,count:p.items.length,url:this.base('caption'),next:'caption_status で内容を確認し caption_generate を使ってください'};
    });
  }
  async captionStatus(session,{offset=0,limit=30}={},signal) {
    if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)throw new Error('offset >= 0、limit は1〜100です');
    const {project:p,job}=await this.captionProject(session,signal);
    return {projectId:p.id,folder:p.source,settings:p.settings,total:p.items.length,empty:p.items.filter(i=>!i.caption.trim()).length,reviewed:p.items.filter(i=>i.reviewed).length,job,items:p.items.slice(offset,offset+limit),offset};
  }
  async captionAction(session,action,args={},signal) {
    return this.serial(async()=>{
      const {project:p,job}=await this.captionProject(session,signal);
      const body={...args,expectedProjectId:p.id};
      if(action==='stop') {
        const owned=this.owned(session,`caption-job-${sessionKey(session)}`,'caption-job');
        if(job?.startedAt!==owned.startedAt)throw new Error('このセッションが開始したキャプション生成ではありません');
        body.expectedJobStartedAt=owned.startedAt;
      }
      if(['generate','save'].includes(action))body.ids=args.ids?.length?args.ids:p.items.map(i=>i.id);
      if(action==='generate') {
        if(active(job?.state))return {job};
        const state=await this.request('caption','/api/engine/status',{signal});
        if(state.managed && state.health==='offline')return {state:'loading',next:'画像認識モデルの起動中です。準備完了後に再実行してください'};
        if(state.health==='offline') {await this.request('caption','/api/engine/start',{body:{},signal});return {state:'loading',next:'media_status(provider=caption) で ready を確認して caption_generate を再実行してください'};}
        if(state.health!=='ready')return {state:state.health,next:'モデルの準備完了後に再実行してください'};
      }
      const route={generate:'/api/job/start',save:'/api/save',edit:'/api/item',stop:'/api/job/stop',settings:'/api/settings'}[action];
      if(!route)throw new Error('キャプション操作が不正です');
      const result=await this.request('caption',route,{body,signal,timeoutMs:120000});
      if(action==='generate')this.save(session,'caption-job',{startedAt:result.startedAt},`caption-job-${sessionKey(session)}`);
      return ['edit','settings'].includes(action)?{updated:true,projectId:p.id}:result;
    });
  }
  async prepareTraining(session,{ids,config={}},signal) {
    return this.serial(async()=>{
      const {project:p}=await this.captionProject(session,signal);
      const defaults=await this.request('caption','/api/training/defaults',{signal});
      const plan=await this.request('caption','/api/training/prepare',{body:{config:{...defaults.settings,...config},ids:ids?.length?ids:p.items.map(i=>i.id),expectedProjectId:p.id},signal,timeoutMs:120000});
      const id=this.save(session,'training',{remoteId:plan.id,projectId:p.id,run:plan.run,trigger:plan.trigger});
      return {id,plan};
    });
  }
  async training(session,id,action,signal) {
    return this.serial(async()=>{
      const ref=this.owned(session,id,'training');
      if(action==='start') {
        const {project:p}=await this.captionProject(session,signal);
        if(p.id!==ref.projectId)throw new Error('学習設定を作成した画像フォルダと異なります');
        return this.request('caption','/api/training/start',{body:{id:ref.remoteId,expectedProjectId:p.id},signal,timeoutMs:120000});
      }
      const current=await this.request('caption','/api/training/status',{signal});
      if(current?.id!==ref.remoteId) {
        if(action==='status') {
          const archived=JSON.parse(await readFile(join(ref.run,'result.json'),'utf8').catch(()=>{throw new Error('学習記録は '+ref.run+' にあります。未開始の場合は start を指定してください');}));
          if(archived.id===ref.remoteId)return archived;
        }
        throw new Error('別の学習が表示されています。元の実行記録は '+ref.run);
      }
      if(action==='stop')return this.request('caption','/api/training/stop',{body:{expectedTrainingId:ref.remoteId},signal});
      if(action!=='status')throw new Error('action は start / status / stop です');
      return current;
    });
  }
  async installLora(session,{id,name,artifact},signal) {
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(name))throw new Error('name は英数字・ハイフン・アンダースコアで80文字以内です');
    const job=await this.training(session,id,'status',signal);
    if(job.state!=='completed')throw new Error('学習完了後に登録してください');
    const source=artifact||job.artifacts.find(p=>basename(p)==='krea2_lora.safetensors')||job.artifacts.at(-1);
    if(!job.artifacts.includes(source))throw new Error('この学習の成果物を指定してください');
    const dir=resolve(this.config.krea.loraDir),target=join(dir,`${name}.safetensors`);
    await mkdir(dir,{recursive:true});await copyFile(source,target,constants.COPYFILE_EXCL);
    await writeFile(join(dir,`${name}.trigger.txt`),job.trigger+'\n',{flag:'wx'});
    return {path:target,trigger:job.trigger,next:'media_status(provider=krea) で LoRA ID を確認し krea_generate の loras に指定してください'};
  }
}
