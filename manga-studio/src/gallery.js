import {createHash} from 'node:crypto';
import {readdir,readFile,stat,realpath,mkdir,rename,unlink} from 'node:fs/promises';
import {join,resolve,extname,dirname,relative,sep} from 'node:path';
import {pageSVG} from './render.js';

const images=new Set(['.png','.jpg','.jpeg','.webp','.bmp','.avif']),videos=new Set(['.mp4','.webm','.mov','.mkv']);
const digest=x=>createHash('sha256').update(x).digest('hex').slice(0,32);
const inside=(base,path)=>path===base||path.startsWith(base+sep);
export class MediaGallery {
  constructor(service){this.service=service;this.assets=new Map();this.collections=new Map();this.pending=new Map();this.tail=Promise.resolve();this.abort=new AbortController();}
  async catalog(){
    const s=this.service,items=[],workspace=resolve(dirname(s.config.library),'..');this.collections.clear();
    const library=JSON.parse(await readFile(s.config.library,'utf8').catch(e=>{if(e.code==='ENOENT')return '{"items":[]}';throw e;}));
    for(const d of library.items.filter(x=>x.kind==='dataset')){
      const root=await realpath(d.path).catch(()=>null);if(!root)continue;
      const allowed=await realpath(join(workspace,'datasets'));
      if(!inside(allowed,root))continue;
      const item={id:'d-'+digest(root),group:'datasets',title:d.name,subtitle:`${d.family} · ${d.category}`,count:d.images+d.videos,missing:d.missingLinks||0,root};
      this.collections.set(item.id,item);items.push(item);
    }
    const projects=s.store.db.prepare('SELECT id,body FROM projects ORDER BY rowid DESC').all();
    for(const row of projects){const p=JSON.parse(row.body),item={id:'p-'+p.id,group:'projects',title:p.title,subtitle:`${p.pages.length}ページ · 第${p.revision}版`,projectId:p.id,count:p.pages.length,updatedAt:p.updatedAt};this.collections.set(item.id,item);items.push(item);}
    const sessions=s.store.db.prepare("SELECT DISTINCT session FROM integrations WHERE kind IN ('media','edit-asset')").all();
    for(const {session} of sessions){const project=projects.find(p=>p.id===session),p=project?JSON.parse(project.body):null;const item={id:'s-'+session,group:'sessions',title:p?.title||`セッション ${session.slice(0,8)}`,subtitle:'生成画像・動画・編集履歴',root:s.store.directory(session)};this.collections.set(item.id,item);items.push(item);}
    for(const [id,title,path]of [['krea','Krea 2の生成履歴','../krea2-darask/outputs'],['h3','H3の生成履歴','../minimaxH3-darask/outputs'],['longvideo','長尺動画の生成履歴','../work/longvideo']]){
      const root=await realpath(resolve(workspace,'manga-studio',path)).catch(()=>null);if(!root||!(await stat(root)).isDirectory())continue;
      const item={id,group:'outputs',title,subtitle:'生成環境に保存したメディア',root};this.collections.set(id,item);items.push(item);
    }
    return items.map(({root,...item})=>item);
  }
  async collection(id){if(!this.collections.has(id))await this.catalog();const c=this.collections.get(id);if(!c)throw Error('コレクションが見つかりません');return c;}
  async list(id,{offset=0,limit=48,query=''}={}){
    if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)throw Error('ページ指定が不正です');
    const c=await this.collection(id),items=[];
    if(c.projectId){
      const p=this.service.store.get(c.projectId);
      for(const [index,page]of p.pages.entries()){
        const asset={id:digest(`${p.id}:${page.id}:${p.revision}`),kind:'page',name:`${index+1}ページ`,caption:page.purpose,projectId:p.id,pageId:page.id,revision:p.revision};
        if(query&&!`${asset.name} ${asset.caption}`.toLowerCase().includes(query.toLowerCase()))continue;
        this.assets.set(asset.id,asset);items.push(asset);
      }
    }else if(await stat(c.root).catch(e=>{if(e.code==='ENOENT')return null;throw e;})){
      const base=await realpath(c.root),files=[];if(base!==c.root)throw Error('フォルダの参照先が変更されました。一覧を更新してください');
      const visit=async(dir,depth=0)=>{
        if(depth>10)return;
        for(const entry of await readdir(dir,{withFileTypes:true})){
          if(entry.name.startsWith('.')||['exports','requests','metadata','previews'].includes(entry.name))continue;
          const file=join(dir,entry.name);
          if(entry.isDirectory()){await visit(file,depth+1);continue;}
          const suffix=extname(entry.name).toLowerCase();if(!images.has(suffix)&&!videos.has(suffix))continue;
          const path=await realpath(file).catch(()=>null);if(!path||!inside(base,path))continue;
          if(query&&!relative(base,file).toLowerCase().includes(query.toLowerCase()))continue;
          const info=await stat(path);if(!info.isFile())continue;files.push({file:path,name:relative(base,file),kind:videos.has(suffix)?'video':'image',bytes:info.size,mtime:info.mtimeMs});
        }
      };
      await visit(base);files.sort((a,b)=>b.mtime-a.mtime||a.name.localeCompare(b.name));
      for(const file of files){const asset={id:digest(`${file.file}:${file.mtime}:${file.bytes}`),...file,root:base};this.assets.set(asset.id,asset);items.push(asset);}
    }
    return {collection:c.id,title:c.title,total:items.length,offset,missing:c.missing||0,projectId:c.projectId,items:items.slice(offset,offset+limit).map(({file,root,...x})=>x)};
  }
  get(id){const a=this.assets.get(id);if(!a)throw Error('一覧を更新してメディアを選び直してください');return a;}
  async detail(id){const a=this.get(id);let caption=a.caption||'';if(a.file){const sidecar=a.file.slice(0,-extname(a.file).length)+'.txt',path=await realpath(sidecar).catch(()=>null);if(path&&inside(a.root,path)&&(await stat(path)).size<128000)caption=await readFile(path,'utf8');}const {root,...safe}=a;return {...safe,caption};}
  async page(asset){const p=this.service.store.get(asset.projectId),page=p.pages.find(x=>x.id===asset.pageId);if(!page)throw Error('ページが更新されました');const images={};for(const panel of page.panels)if(panel.image)images[panel.id]=`data:image/png;base64,${(await this.service.readImage(p.id,panel.image)).toString('base64')}`;return pageSVG(page,images);}
  async file(id,thumbnail=false){
    const a=this.get(id);if(a.kind==='page')return {bytes:Buffer.from(await this.page(a)),type:'image/svg+xml'};
    const resolved=await realpath(a.file);if(!inside(a.root,resolved))throw Error('参照先が変更されました');
    const suffix=extname(a.file).toLowerCase();
    if(!thumbnail)return {path:resolved,type:({'.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.mkv':'video/x-matroska','.jpg':'image/jpeg','.jpeg':'image/jpeg'}[suffix]||'image/'+suffix.slice(1))};
    const dir=join(this.service.store.root,'.gallery-cache'),target=join(dir,id+'.jpg');await mkdir(dir,{recursive:true});
    if(!(await stat(target).catch(()=>null))){
      if(!this.pending.has(id)){
        const work=this.tail.then(async()=>{
          const temporary=target+'.part',signal=AbortSignal.any([this.abort.signal,AbortSignal.timeout(30000)]);
          const h=this.service.subprocess.spawn({argv:['ffmpeg','-nostdin','-y','-v','error','-threads','1','-protocol_whitelist','file,pipe','-i',resolved,'-vf','scale=360:360:force_original_aspect_ratio=decrease','-frames:v','1','-threads','1','-f','image2','-c:v','mjpeg',temporary],cwd:this.service.store.root,stdio:{stdin:'ignore',stdout:{maxBytes:1024},stderr:{maxBytes:1024}},signal,graceMs:3000});
          try{const r=await h.done;await h.waitForExit();if(r.exitCode!==0)throw Error('サムネイルを作成できません');await rename(temporary,target);}finally{await unlink(temporary).catch(()=>{});}
        });this.tail=work.catch(()=>{});this.pending.set(id,work.finally(()=>this.pending.delete(id)));
      }
      await this.pending.get(id);
    }
    return {path:target,type:'image/jpeg'};
  }
  close(){this.abort.abort();}
}
