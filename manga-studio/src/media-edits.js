import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { join, extname, isAbsolute } from 'node:path';
import { sessionKey } from './store.js';
import { packageRoot } from './config.js';
import { getPage } from './model.js';

/** Immutable editing assets; a result reaches a manga panel only on commit. */
export class MediaEdits {
  constructor(service) {
    this.service=service;this.store=service.store;this.config=service.config.editing;this.live=new Map();this.tail=Promise.resolve();
    for(const row of this.store.db.prepare("SELECT * FROM integrations WHERE kind='edit-job'").all()) {
      const job=JSON.parse(row.body);
      if(['queued','running'].includes(job.status))this.put(row.session,'edit-job',{...job,status:'interrupted',error:'DSH が終了しました。元の画像・動画は保持されています。'});
    }
  }
  put(owner,kind,value) {this.store.db.prepare('INSERT OR REPLACE INTO integrations VALUES (?,?,?,?)').run(value.id,owner,kind,JSON.stringify(value));return value;}
  get(owner,id,kind='edit-asset') {
    const row=this.store.db.prepare('SELECT body FROM integrations WHERE id=? AND session=? AND kind=?').get(id,owner,kind);
    if(!row)throw new Error('このセッションの編集データが見つかりません');return JSON.parse(row.body);
  }
  jobs(owner,assetId) {
    this.get(owner,assetId);
    return this.store.db.prepare("SELECT body FROM integrations WHERE session=? AND kind='edit-job' AND json_extract(body,'$.assetId')=? ORDER BY rowid DESC LIMIT 20").all(owner,assetId).map(row=>{
      const {id,status,mode,progress,error,outputPath}=JSON.parse(row.body);return {id,status,mode,progress,error,outputPath};
    });
  }
  dir(owner,id) {if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('編集IDが不正です');return join(this.store.directory(owner),'edits',id);}
  path(owner,asset,version=asset.current) {
    const selected=asset.versions.find(v=>v.id===version);if(!selected)throw new Error('編集版が見つかりません');return join(this.dir(owner,asset.id),selected.file);
  }
  async worker(request,signal,onProgress=()=>{}) {
    const c=this.config;
    const argv=[c.python,join(packageRoot,'python/edit_media.py')];if(c.wrapper)argv.unshift('bash',c.wrapper);
    await mkdir(c.cacheDir,{recursive:true});
    const handle=this.service.subprocess.spawn({argv,cwd:c.mosaicRepo,env:{HF_HOME:join(c.cacheDir,'huggingface'),TORCH_HOME:join(c.cacheDir,'torch'),XDG_CACHE_HOME:c.cacheDir,PYTHONUNBUFFERED:'1',OMP_NUM_THREADS:'4'},stdio:{stdin:{data:JSON.stringify({...request,mosaicRepo:c.mosaicRepo})},stdout:'pipe',stderr:{maxBytes:12000}},signal,graceMs:3000});
    let buffer='',result,error;
    handle.stdout?.setEncoding('utf8');handle.stdout?.on('data',chunk=>{
      buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop();
      for(const line of lines) {let event;try{event=JSON.parse(line);}catch{continue;}if(event.progress)onProgress(event.progress);if(event.error)error=event.error;if(event.result)result=event.result;}
    });
    const outcome=await handle.done;await handle.waitForExit();signal?.throwIfAborted();
    if(outcome.exitCode!==0||error||!result)throw new Error(error||`画像編集処理が停止しました: ${handle.collected.stderr?.readFrom(0)?.text||outcome.exitCode}`);
    return result;
  }
  async open(session,{path,pageId,panelId},signal) {
    const owner=sessionKey(session);let panel;
    if(pageId||panelId) {
      const p=this.store.get(owner),target=getPage(p,pageId).panels.find(v=>v.id===panelId);
      if(!target?.image)throw new Error('画像のあるコマを選択してください');
      path=join(this.store.directory(owner),target.image);panel={pageId,panelId,sourceImage:target.image};
    }
    if(typeof path!=='string'||!isAbsolute(path))throw new Error('画像・MP4 の絶対パスを指定してください');
    const suffix=extname(path).toLowerCase();if(!['.png','.jpg','.jpeg','.webp','.mp4'].includes(suffix))throw new Error('PNG/JPEG/WebP/MP4 に対応しています');
    const input=await stat(path);if(!input.isFile()||input.size>4*1024**3)throw new Error('4GB以下のファイルを指定してください');
    const id=randomUUID(),directory=this.dir(owner,id);await mkdir(directory,{recursive:true});
    const file='original'+suffix;await copyFile(path,join(directory,file));
    const metadata=await this.worker({mode:'info',source:join(directory,file)},signal);
    const asset={id,revision:1,...metadata,panel,current:'original',versions:[{id:'original',file,label:'元の画像・動画'}],createdAt:new Date().toISOString()};
    return this.put(owner,'edit-asset',asset);
  }
  enqueue(owner,{assetId,revision,mode,mask,regions,autoDetect=false,categories,threshold=.3,refine=false,margin=4,block=0,time=0,startSeconds=0,endSeconds}) {
    if(!['inpaint','mosaic','detect'].includes(mode))throw new Error('mode は inpaint / mosaic / detect です');
    if(!Number.isFinite(threshold)||threshold<0||threshold>1||!Number.isInteger(margin)||margin<0||margin>100||!Number.isInteger(block)||block<0||block>512)throw new Error('検出・モザイク設定が不正です');
    if(mask && (typeof mask!=='string'||mask.length>8*1024*1024||!mask.startsWith('data:image/png;base64,')))throw new Error('マスクは PNG の data URL です');
    if(regions && (!Array.isArray(regions)||regions.length>100))throw new Error('矩形は100個以内です');
    const asset=this.get(owner,assetId);if(asset.revision!==revision)throw new Error('編集内容が変わっています。再読み込みしてください');
    if(!Number.isFinite(time)||time<0||!Number.isFinite(startSeconds)||startSeconds<0||(endSeconds!==undefined&&(!Number.isFinite(endSeconds)||endSeconds<=startSeconds)))throw new Error('動画の時間指定が不正です');
    if(asset.kind==='video'&&mode==='inpaint')throw new Error('IOPaint 修正は静止画に対応しています');
    if([...this.live.values()].some(x=>x.assetId===assetId))throw new Error('この画像・動画は処理中です');
    const job={id:randomUUID(),assetId,base:asset.current,mode,status:'queued',progress:'処理待ち',createdAt:new Date().toISOString()};
    this.put(owner,'edit-job',job);const controller=new AbortController();this.live.set(job.id,{controller,assetId});
    this.tail=this.tail.then(async()=>{
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(this.config.timeoutMs)]);
      try {
        signal.throwIfAborted();job.status='running';this.put(owner,'edit-job',job);
        const file=job.id+(asset.kind==='video'?'.mp4':'.png');
        const result=await this.worker({mode,source:this.path(owner,asset),output:join(this.dir(owner,assetId),file),mask,regions,autoDetect,categories,threshold,refine,margin,block,time,startSeconds,endSeconds},signal,progress=>{job.progress=progress;this.put(owner,'edit-job',job);});
        job.result=result;
        if(mode!=='detect') {
          const current=this.get(owner,assetId);
          current.versions.push({id:job.id,file,label:mode==='inpaint'?'IOPaint 修正':'モザイク',createdAt:new Date().toISOString()});
          if(current.current===job.base&&current.revision===revision)current.current=job.id;else job.superseded=true;
          current.revision++;this.put(owner,'edit-asset',current);
          job.outputPath=join(this.dir(owner,assetId),file);
        }
        job.status='completed';job.progress='完了';
      }catch(error){job.status=controller.signal.aborted?'cancelled':'failed';job.error=error.message;}
      finally {job.finishedAt=new Date().toISOString();this.put(owner,'edit-job',job);this.live.delete(job.id);}
    });
    return job;
  }
  cancel(owner,id) {const job=this.get(owner,id,'edit-job');this.live.get(id)?.controller.abort();return {...job,cancelRequested:true};}
  select(owner,{assetId,revision,version}) {
    const asset=this.get(owner,assetId);if(asset.revision!==revision)throw new Error('編集内容が変わっています');this.path(owner,asset,version);
    asset.current=version;asset.revision++;return this.put(owner,'edit-asset',asset);
  }
  async commit(owner,{assetId,revision}) {
    const asset=this.get(owner,assetId);if(asset.revision!==revision)throw new Error('編集内容が変わっています');
    if(!asset.panel)return {outputPath:this.path(owner,asset)};
    const p=this.store.get(owner),panel=getPage(p,asset.panel.pageId).panels.find(x=>x.id===asset.panel.panelId);
    if(panel?.image!==asset.panel.sourceImage)throw new Error('元のコマが更新されています。新しいコマを開き直してください');
    const image=`images/${panel.id}-${randomUUID()}.png`;
    await copyFile(this.path(owner,asset),join(this.store.directory(owner),image));
    if(this.get(owner,assetId).revision!==revision)throw new Error('編集内容が変わっています。再読み込みしてください');
    const updated=this.store.update(owner,p.revision,state=>getPage(state,asset.panel.pageId).panels.find(x=>x.id===panel.id).image=image);
    asset.panel.sourceImage=image;asset.revision++;this.put(owner,'edit-asset',asset);
    return {project:updated,asset,outputPath:join(this.store.directory(owner),image)};
  }
  async close() {for(const {controller} of this.live.values())controller.abort();await this.tail;}
}
