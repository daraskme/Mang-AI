import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile,realpath,readdir,stat} from 'node:fs/promises';
import {join,dirname,resolve,sep,extname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {packageRoot} from './config.js';
import {sessionKey} from './store.js';

const providers=new Set(['krea','h3','longvideo']);
const keyOf=(provider,kind,id)=>createHash('sha256').update(JSON.stringify([provider,kind,id])).digest('hex').slice(0,32);
const execute=promisify(execFile);
const referenceKinds=new Set(['reference','training','generated']);
const inside=(base,path)=>path===base||path.startsWith(base+sep);

/** Catalog metadata lives beside the artwork, never inside model weight folders. */
export class ModelLibrary {
  constructor(studios){this.studios=studios;this.store=studios.store;this.db=this.store.db;
    this.db.exec('CREATE TABLE IF NOT EXISTS model_catalog (key TEXT PRIMARY KEY, provider TEXT NOT NULL, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS model_thumbnails (key TEXT PRIMARY KEY, body TEXT NOT NULL)');
  }
  async catalog(provider,{refresh=false}={}){
    if(!providers.has(provider))throw Error('モデル一覧の生成環境が不正です');
    let error;
    const cached=this.db.prepare('SELECT body FROM model_catalog WHERE provider=?').all(provider);
    if(refresh||!cached.length){
      try{
        let models,loras;
        if(provider==='krea'){
          [models,loras]=await Promise.all(['/api/models','/api/loras'].map(path=>this.studios.request(provider,path,{timeoutMs:5000})));models=models.items;loras=loras.items;
        }else if(provider==='h3'){
          const data=await this.studios.request(provider,'/api/inventory',{timeoutMs:5000});models=data.models;loras=data.loras;
        }else{
          const data=await this.studios.request(provider,'/object_info',{timeoutMs:10000});models=data.UNETLoader.input.required.unet_name[0];loras=data.LoraLoaderModelOnly.input.required.lora_name[0];
        }
        if(!Array.isArray(models)||!Array.isArray(loras))throw Error('モデル一覧の形式が不正です');
        const library=JSON.parse(await readFile(this.studios.config.library,'utf8').catch(error=>{if(error.code==='ENOENT')return '{"items":[]}';throw error;}));
        const items=[...models.map(m=>['model',m]),...loras.map(l=>['lora',l])].map(([kind,item])=>{
          const data=typeof item==='string'?{name:item}:item;
          const id=provider==='krea'?(data.id||data.name):(data.path||data.id||data.name);
          if(typeof id!=='string'||!id.trim())throw Error('モデルIDがありません');
          const registered=library.items?.find(item=>item.kind==='lora'&&item.family===(provider==='krea'?'krea2':'h3')&&item.loraId===id);
          return {key:keyOf(provider,kind,id),provider,kind,id,name:data.label||data.name||id,available:data.available!==false&&data.ready!==false,reason:data.reason,trigger:data.trigger||data.trigger_words||registered?.trigger||'',category:registered?.category||data.category,source:data.source||'',bytes:data.size_bytes||data.bytes||data.size,updatedAt:new Date().toISOString()};
        });
        this.db.exec('BEGIN IMMEDIATE');
        try{this.db.prepare('DELETE FROM model_catalog WHERE provider=?').run(provider);for(const item of items)this.db.prepare('INSERT INTO model_catalog VALUES (?,?,?)').run(item.key,provider,JSON.stringify(item));this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
      }catch(e){error=e.message;}
    }
    const items=this.db.prepare('SELECT body FROM model_catalog WHERE provider=?').all(provider).map(row=>{const item=JSON.parse(row.body);const thumbnail=this.db.prepare('SELECT body FROM model_thumbnails WHERE key=?').get(item.key);return {...item,thumbnail:thumbnail?JSON.parse(thumbnail.body):null};});
    return {provider,items,cached:!!error,error,...error?{note:'生成環境へ未接続です。保存済みの一覧を表示しています。環境を起動して一覧を更新してください。'}:{}};
  }
  async thumbnail(key,dataUrl,{kind='reference'}={}){
    if(!this.db.prepare('SELECT key FROM model_catalog WHERE key=?').get(key))throw Error('モデルを一覧から選び直してください');
    if(!referenceKinds.has(kind))throw Error('参考画像の種類が不正です');
    const match=/^data:image\/(png|jpeg|webp|avif);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl||'');
    if(!match||match[2].length>8*1024*1024)throw Error('サムネイルは6MB以下のPNG/JPEG/WebP/AVIFです');
    const bytes=Buffer.from(match[2],'base64'),type=match[1];
    if(type==='png'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||type==='jpeg'&&!(bytes[0]===255&&bytes[1]===216)||type==='webp'&&!(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'))throw Error('画像の形式が一致しません');
    if(type==='avif'&&(bytes.toString('ascii',4,8)!=='ftyp'||!bytes.subarray(8,Math.min(bytes.length,64)).includes(Buffer.from('avif'))))throw Error('画像の形式が一致しません');
    const revision=createHash('sha256').update(bytes).digest('hex').slice(0,12),file=`${key}-${revision}.${type}`;
    const dir=join(this.store.root,'.model-thumbnails');await mkdir(dir,{recursive:true});await writeFile(join(dir,file),bytes);
    const record={file,type:'image/'+type,revision,kind,updatedAt:new Date().toISOString()};this.db.prepare('INSERT OR REPLACE INTO model_thumbnails VALUES (?,?)').run(key,JSON.stringify(record));return record;
  }
  clearThumbnail(key){
    if(!this.db.prepare('SELECT key FROM model_catalog WHERE key=?').get(key))throw Error('モデルを一覧から選び直してください');
    this.db.prepare('DELETE FROM model_thumbnails WHERE key=?').run(key);return {thumbnail:null};
  }
  async referenceRoots(){
    const root=resolve(dirname(this.studios.config.library),'..');
    return (await Promise.all([this.store.root,...['datasets','datasets-optimized','datasets-archive','caption-studio/training-runs','krea2-darask/outputs','minimaxH3-darask/outputs'].map(p=>join(root,p))].map(p=>realpath(p).catch(()=>null)))).filter(Boolean);
  }
  async thumbnailFromFile(key,file,{kind='reference'}={}){
    const path=await realpath(file),roots=await this.referenceRoots();
    if(!roots.some(root=>inside(root,path)))throw Error('データセットまたは生成物のフォルダから選んでください');
    if(!['.png','.jpg','.jpeg','.webp','.avif','.bmp','.mp4','.webm','.mov','.mkv'].includes(extname(path).toLowerCase()))throw Error('画像または動画を選んでください');
    const root=resolve(dirname(this.studios.config.library),'..');
    const python=this.studios.config.thumbnailPython||join(root,'caption-studio/runtime/python-run');
    const {stdout}=await execute(python,[join(packageRoot,'scripts/make-model-thumbnail.py'),path],{encoding:'buffer',timeout:30000,maxBuffer:6*1024*1024});
    return this.thumbnail(key,'data:image/png;base64,'+stdout.toString('base64'),{kind});
  }
  async thumbnailCandidates(key){
    const row=this.db.prepare('SELECT body FROM model_catalog WHERE key=?').get(key);if(!row)throw Error('モデルを一覧から選び直してください');
    const item=JSON.parse(row.body),library=JSON.parse(await readFile(this.studios.config.library,'utf8'));
    const lora=library.items.find(l=>l.kind==='lora'&&l.family===(item.provider==='krea'?'krea2':'h3')&&l.loraId===item.id);
    if(!lora)return {items:[],note:'対応する学習データの登録がありません。画像をアップロードできます。'};
    const datasets=library.items.filter(d=>d.kind==='dataset'&&d.family===lora.family&&[lora.name,lora.trigger].includes(d.name));
    const roots=await this.referenceRoots(),items=[];
    const visit=async(dir,depth=0)=>{
      if(depth>8||items.length>=48)return;
      const real=await realpath(dir).catch(()=>null);if(!real||!roots.some(root=>inside(root,real)))return;
      for(const e of (await readdir(real,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
        if(e.name.startsWith('.')||items.length>=48)continue;
        const path=join(real,e.name);
        if(e.isDirectory())await visit(path,depth+1);
        else if(['.png','.jpg','.jpeg','.webp','.avif','.bmp','.mp4','.webm','.mov','.mkv'].includes(extname(e.name).toLowerCase())){
          const file=await realpath(path).catch(()=>null);
          if(file&&roots.some(root=>inside(root,file))&&(await stat(file)).isFile())items.push({file,name:e.name,kind:'training'});
        }
      }
    };
    for(const dataset of datasets)await visit(dataset.path);
    return {items,note:'学習データの参考画像です。このLoRAの生成結果を示すものではありません。動画は先頭フレームを使います。'};
  }
  async thumbnailFile(key){
    if(!/^[a-f0-9]{32}$/.test(key))throw Error('モデルIDが不正です');
    const row=this.db.prepare('SELECT body FROM model_thumbnails WHERE key=?').get(key);if(!row)throw Error('サムネイルがありません');const data=JSON.parse(row.body);
    return {type:data.type,bytes:await readFile(join(this.store.root,'.model-thumbnails',data.file))};
  }
  selected(session,provider){
    const row=this.db.prepare("SELECT body FROM integrations WHERE session=? AND kind='generation-selection' AND id=?").get(sessionKey(session),`${sessionKey(session)}-${provider}`);
    return row?JSON.parse(row.body):null;
  }
  async select(session,{provider,model,loras=[]}){
    const {items,error}=await this.catalog(provider);
    const base=items.find(item=>item.kind==='model'&&item.id===model);
    if(!base||!base.available)throw Error('選択したモデルは一覧にありません。環境を起動して一覧を更新してください');
    if(!Array.isArray(loras)||loras.length>32)throw Error('LoRAは32個以内です');
    const seen=new Set();
    const adapters=loras.map(l=>{
      const found=items.find(item=>item.kind==='lora'&&item.id===l.id);if(!found||!found.available||seen.has(l.id))throw Error('LoRAが見つからないか重複しています');seen.add(l.id);
      if(!Number.isFinite(l.weight)||Math.abs(l.weight)>4)throw Error('LoRA強度は-4〜4です');
      if(!['character','style','other'].includes(l.role||'other'))throw Error('LoRA用途が不正です');
      return {id:l.id,weight:l.weight,enabled:l.enabled!==false,role:l.role||'other',trigger:found.trigger};
    });
    const selection={provider,model,loras:adapters,updatedAt:new Date().toISOString()};
    this.studios.save(session,'generation-selection',selection,`${sessionKey(session)}-${provider}`);
    return {...selection,...error?{note:'保存済み一覧から選択しました。生成前に実体の存在を再確認します。'}:{}};
  }
  generation(session,provider){
    const selection=this.selected(session,provider);if(!selection)return {};
    return {[provider==='krea'?'model_id':'model']:selection.model,loras:selection.loras.map(l=>({[provider==='krea'?'id':'path']:l.id,weight:l.weight,enabled:l.enabled}))};
  }
}
