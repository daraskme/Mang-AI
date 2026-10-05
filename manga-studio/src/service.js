import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Store, sessionKey, scriptDigest } from './store.js';
import { editLettering, getPage, integer, normalizeScript, replaceScript, text, LAYOUTS } from './model.js';
import { pageSVG, letteringWarnings, escapeXML } from './render.js';
import { writeScript } from './creative.js';
import { packageRoot } from './config.js';
import { LocalStudios } from './local-studios.js';
import { MediaEdits } from './media-edits.js';
import { WorkflowProgress } from './progress.js';
import { writePlan, validatePlan, applyPlan, planningContext, visualContinuity } from './manga-planning.js';

/** Session-owned authoring and a single GPU queue shared by the DSH plugin. */
export class MangaService {
  constructor(config, subprocess, {creative=writeScript,planner=writePlan}={}) {
    this.config=config; this.subprocess=subprocess; this.creative=creative;this.planner=planner;
    this.store=new Store(config.dataDir); this.store.recoverJobs();
    this.studios=new LocalStudios(config,this.store,subprocess);
    this.edits=new MediaEdits(this);
    this.progress=new WorkflowProgress(this);
    this.live=new Map(); this.queue=Promise.resolve(); this.closed=false;
  }
  create(session,args) {return this.store.create(session,args);}
  status(session) {
    const p=this.store.get(sessionKey(session));
    return {project:p,jobs:this.store.jobs(p.id),warnings:letteringWarnings(p)};
  }
  async plan(session,{stage,instruction,pageId,revision,pageCount},signal) {
    text(instruction,'制作指示');
    const project=this.store.get(sessionKey(session));
    if(project.revision!==revision)throw Error(`別の操作で更新されています。現在のrevisionは${project.revision}です。manga_statusで確認し、その値をそのまま指定してください。成功時だけrevisionが更新されます。`);
    if(pageCount!==undefined)integer(pageCount,'ページ数',1,32);
    if(stage==='all'){
      // Each stage is separately persisted and validated; a failed run can resume.
      let current=project,result;
      const run=async(next,id)=>{result=await this.plan(session,{stage:next,pageId:id,instruction,pageCount,revision:current.revision},signal);current=result.project;};
      if(!current.production?.settings)await run('settings');
      if(!current.production?.pages)await run('pages');
      if(pageCount!==undefined&&current.production.pages.pages.length!==pageCount)throw Error('保存済みページ数が指定と異なります。pages工程で配分を修正してください');
      for(const page of current.production.pages.pages)if(!current.production.prompts?.[page.id])await run('prompts',page.id);
      return {project:current,next:'lettering_review',trace:result?.trace};
    }
    planningContext(project,stage,pageId);
    return this.progress.track(project.id,stage,async()=>{
      const constrained=pageCount===undefined?instruction:`${instruction}\n必須条件：作品全体は${pageCount}ページです。ページごとのコマ数と混同しないでください。`;
      const result=await this.planner({...project,generationSelection:this.studios.models.selected(session,'krea')},this.config.gemma,{stage,instruction:constrained,pageId},signal);
      signal.throwIfAborted();
      const value=validatePlan(stage,result.value,project,pageId);
      if(stage==='pages'&&pageCount!==undefined&&value.pages.length!==pageCount)throw Error(`ページ数は${pageCount}ページの指定ですがGemmaは${value.pages.length}ページを返しました。pages工程を修正してください`);
      const dir=join(this.store.directory(project.id),'requests');await mkdir(dir,{recursive:true});
      const trace=join(dir,`gemma-${stage}-${randomUUID()}.json`);await writeFile(trace,JSON.stringify(result,null,2));
      const updated=this.store.update(project.id,revision,p=>applyPlan(p,stage,value,{pageId,instruction,trace}));
      return {project:updated,trace,next:stage==='settings'?'pages':stage==='pages'?'prompts':'lettering_review'};
    });
  }
  async draft(session,{instruction,pageCount,revision},signal) {
    integer(pageCount,'ページ数',1,32); text(instruction,'指示');
    const p=this.store.get(sessionKey(session));
    if(p.revision!==revision) return this.store.update(p.id,revision,()=>{});
    return this.progress.track(p.id,'draft',async()=>{
    const result=await this.creative(p,this.config.gemma,instruction,pageCount,signal);
    signal.throwIfAborted();
    const requestDir=join(this.store.directory(p.id),'requests');
    await mkdir(requestDir,{recursive:true});
    const trace=join(requestDir,`gemma-${randomUUID()}.json`);
    await writeFile(trace,JSON.stringify(result,null,2),'utf8');
    const updated=this.store.update(p.id,revision,state=>replaceScript(state,result.pages));
    return {project:updated,trace};
    });
  }
  setScript(session,{script,revision}) {
    const pages=normalizeScript(script);
    return this.store.update(sessionKey(session),revision,p=>replaceScript(p,pages));
  }
  letter(session,args) {
    const p=this.store.update(sessionKey(session),args.revision,state=>editLettering(state,args));
    return {project:p,warnings:letteringWarnings(p)};
  }
  approve(id,revision) {
    return this.store.update(id,revision,p=>{
      if(!p.pages.length) throw new Error('先に脚本を作成してください');
      p.approved=scriptDigest(p);
      for(const page of p.pages) page.letteringNeedsReview=false;
    });
  }
  async render(session,{pageId,regenerate=false,seed=0,model_id,preset,loras}) {
    if(this.closed) throw new Error('Studio は終了中です');
    const p=this.store.get(sessionKey(session)), page=getPage(p,pageId);
    if(p.production && (!p.production.pages||!p.production.prompts?.[pageId]))throw Error('設定またはページ配分が変更されています。このページのプロンプトをGemmaで更新してください');
    if(p.approved!==scriptDigest(p)) throw new Error('編集画面で脚本を確認し「脚本を確定」を押してください');
    integer(seed,'seed',0,2147483647);
    if(this.store.jobs(p.id).some(j=>j.pageId===pageId && ['queued','running'].includes(j.status))) throw new Error('このページは生成中です。manga_status で進捗を確認してください');
    const panels=page.panels.filter(panel=>regenerate || !panel.image);
    if(!panels.length) throw new Error('全コマの画像があります。再生成する場合だけ regenerate=true を指定してください');
    const k=this.config.krea;
    if(model_id!==undefined && (typeof model_id!=='string'||!model_id.trim()))throw new Error('model_id が不正です');
    if(preset!==undefined && !['turbo8','fast4','raw'].includes(preset))throw new Error('preset が不正です');
    if(loras!==undefined && (!Array.isArray(loras)||loras.some(l=>!l||typeof l.id!=='string'||(l.weight!==undefined&&(!Number.isFinite(l.weight)||Math.abs(l.weight)>4)))))throw new Error('loras が不正です');
    if(k.backend!=='studio' && [model_id,preset,loras].some(v=>v!==undefined))throw new Error('モデル・LoRAの個別指定には Krea Studio 接続が必要です');
    const selected=this.studios.models.generation(session,'krea');
    const generation=structuredClone({model_id:model_id??selected.model_id??k.model,preset:preset??k.preset??'turbo8',loras:loras??selected.loras??k.loras??[]});
    if(k.backend==='studio')await this.studios.request('krea','/health');
    else {
      if(!k.weights) throw new Error(`${k.checkpoint==='oss_raw'?'OSS_RAW':'OSS_TURBO'} または krea.weights に重みのパスを設定してください`);
      await Promise.all([access(join(k.repo,'inference.py')),access(k.python),access(k.weights)]);
    }
    const job={id:randomUUID(),project:p.id,pageId,status:'queued',createdAt:new Date().toISOString(),digest:scriptDigest(p),panels:panels.map(x=>x.id),completed:[],seed,generation,error:null};
    this.store.saveJob(job);
    const controller=new AbortController();
    this.live.set(job.id,controller);
    this.queue=this.queue.then(()=>this.runJob(job,p,page,panels,controller)).catch(error=>{
      this.store.saveJob({...this.store.getJob(job.id),status:'failed',error:error.message});
    }).finally(()=>this.live.delete(job.id));
    return job;
  }
  async runJob(job,project,page,panels,controller) {
    if(controller.signal.aborted) {this.store.saveJob({...job,status:'canceled'});return;}
    if(scriptDigest(this.store.get(job.project))!==job.digest) {this.store.saveJob({...job,status:'superseded'});return;}
    job.status='running';this.store.saveJob(job);
    const k=this.config.krea, dir=join(this.store.directory(job.project),'images');
    await mkdir(dir,{recursive:true});
    const requests=panels.map((panel,i)=>{
      const [, ,w,h]=LAYOUTS[page.layout][page.panels.findIndex(p=>p.id===panel.id)];
      const scale=Math.min(k.width/w,k.height/h);
      const fixed=visualContinuity(project,page,panel);
      const prompt=`${project.style}\n${fixed||'Character consistency notes: '+project.characters}\n${panel.artPrompt}\nOne single manga panel. Artwork only, no lettering, no speech bubbles, no captions, no written words, no watermark. Leave breathing room for separate lettering.`;
      if(k.backend==='studio'&&prompt.length>4000)throw Error(`${panel.id}の設定と作画指示がKreaの4000文字上限を超えています。固定外見を保ってGemmaで簡潔にしてください`);
      return {id:panel.id,output:join(dir,`${panel.id}-${job.id}.png`),seed:(job.seed+i)%2147483648,
        width:Math.max(256,Math.round(w*scale/16)*16),height:Math.max(256,Math.round(h*scale/16)*16),
        prompt};
    });
    const request={...k,panels:requests};
    job.outputs=requests.map(req=>({id:req.id,image:`images/${req.id}-${job.id}.png`}));
    this.store.saveJob(job);
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(k.timeoutMs)]);
    let outcome, failure;
    try {
      if(k.backend==='studio') {
        for(const req of requests) {
          await this.studios.renderKrea({...req,...job.generation},signal,remoteId=>{job.remoteId=remoteId;job.progress=null;this.store.saveJob(job);},remote=>{
            job.progress={panelId:req.id,stage:remote.stage,message:remote.message,ratio:Number.isFinite(remote.progress)?Math.max(0,Math.min(1,remote.progress)):null};this.store.saveJob(job);
          });
          job.completed.push(req.id);this.store.saveJob(job);
        }
      } else {
      const argv=[k.python,join(packageRoot,'python/render_krea.py')];
      if(this.config.gpu?.enabled)argv.unshift(k.python,join(packageRoot,'python/mangai_gpu.py'),'krea','--');
      const handle=this.subprocess.spawn({
        argv,cwd:k.repo,
        env:{[k.checkpoint==='oss_raw'?'OSS_RAW':'OSS_TURBO']:k.weights,PYTHONUNBUFFERED:'1',...this.config.gpu?.enabled?{MANGAI_GPU_STATE:join(packageRoot,'../work/gpu')}:{ }},
        stdio:{stdin:{data:JSON.stringify(request)},stdout:'pipe',stderr:{maxBytes:32768}},graceMs:5000,signal,
      });
      let buffer='';
      handle.stdout?.setEncoding('utf8');
      handle.stdout?.on('data',chunk=>{
        buffer=(buffer+chunk).slice(-65536);
        const lines=buffer.split('\n');buffer=lines.pop();
        for(const line of lines){
          let value;try{value=JSON.parse(line);}catch{continue;}
          if(requests.some(req=>req.id===value.panel && req.output===value.saved) && !job.completed.includes(value.panel)){
            job.completed.push(value.panel);this.store.saveJob(job);
          }
        }
      });
      outcome=await handle.done;
      await handle.waitForExit();
      if(outcome.exitCode!==0) failure=new Error(`Krea Python が終了コード ${outcome.exitCode} で停止しました。${handle.collected.stderr?.readFrom(0)?.text || ''}`);
      }
    } catch(error) {failure=error;}
    // Collect completed panels even after cancellation. Never attach stale art.
    const current=this.store.get(job.project),fresh=scriptDigest(current)===job.digest;
    const completed=[];
    for(const req of requests) {
      try {
        const bytes=await readFile(req.output);
        if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Krea の出力が PNG ではありません');
        completed.push({id:req.id,image:`images/${req.id}-${job.id}.png`});
      } catch(error) {if(error.code!=='ENOENT') failure=error;}
    }
    if(fresh && completed.length) this.store.update(job.project,current.revision,p=>{
      const target=getPage(p,page.id);
      for(const image of completed) target.panels.find(panel=>panel.id===image.id).image=image.image;
    });
    job.completed=completed.map(x=>x.id);
    job.status=!fresh?'superseded':controller.signal.aborted?'canceled':signal.aborted?'failed':failure||completed.length!==requests.length?'failed':'completed';
    job.error=signal.aborted && !controller.signal.aborted?'Krea 生成が制限時間を超えました':failure?.message.slice(-6000) || null;
    job.finishedAt=new Date().toISOString();
    this.store.saveJob(job);
  }
  cancel(session,jobId) {
    const job=this.store.getJob(jobId);
    if(job.project!==sessionKey(session)) throw new Error('別セッションのジョブは操作できません');
    const controller=this.live.get(jobId);
    if(!controller) return job;
    controller.abort();
    return {...job,cancelRequested:true};
  }
  async export(session) {
    const p=this.store.get(sessionKey(session));
    if(!p.pages.length) throw new Error('ページがありません');
    return this.progress.track(p.id,'export',async()=>{
    const dir=join(this.store.directory(p.id),'exports',`r${p.revision}-${randomUUID().slice(0,8)}`);
    await mkdir(dir,{recursive:true});
    const files=[];
    for(const [i,page] of p.pages.entries()) {
      const images={};
      for(const panel of page.panels) if(panel.image) images[panel.id]=`data:image/png;base64,${(await this.readImage(p.id,panel.image)).toString('base64')}`;
      const filename=`page-${String(i+1).padStart(3,'0')}.svg`;
      await writeFile(join(dir,filename),pageSVG(page,images),'utf8'); files.push(filename);
    }
    const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><title>${escapeXML(p.title)}</title><style>body{margin:0;background:#28282a;color:white;font:16px sans-serif}header{padding:24px}main{max-width:900px;margin:auto}img{display:block;width:100%;margin-bottom:24px}a{color:#dac8a1}@media print{@page{size:A5;margin:0}header{display:none}body{background:white}img{height:100vh;width:100%;object-fit:contain;break-after:page;margin:0}}</style><header><h1>${escapeXML(p.title)}</h1><p>全${p.pages.length}ページ · 印刷からPDF保存できます</p><a href="project.json">編集データ</a></header><main>${files.map(f=>`<img src="${f}" alt="${f}">`).join('')}</main></html>`;
    await writeFile(join(dir,'index.html'),html,'utf8');
    await writeFile(join(dir,'project.json'),JSON.stringify(p,null,2),'utf8');
    return {directory:dir,html:join(dir,'index.html'),pages:files.map(f=>join(dir,f)),warnings:[...letteringWarnings(p),...p.pages.flatMap(pg=>pg.panels.filter(x=>!x.image).map(x=>`${x.id}: 作画待ち`))]};
    },p.revision);
  }
  async readImage(id,image) {
    if(!/^images\/p\d+-c\d+-[a-f0-9-]+\.png$/.test(image)) throw new Error('画像パスが不正です');
    return readFile(join(this.store.directory(id),image));
  }
  async close() {
    this.closed=true;
    await this.edits.close();
    for(const controller of this.live.values()) controller.abort();
    await this.queue;
    this.store.close();
  }
}
