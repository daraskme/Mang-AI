import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DEFAULT_PROMPT, normalizePrompt, lintCaption } from './prompts.mjs';
export const EXTENSIONS = new Map([['.png','image/png'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.webp','image/webp'],['.bmp','image/bmp'],['.avif','image/avif']]);
export const exists = async p => !!(await fs.stat(p).catch(()=>null));
export async function atomicWrite(file, content) {
  await fs.mkdir(path.dirname(file), {recursive:true});
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temp,content,{flag:'wx'}); await fs.rename(temp,file); }
  finally { await fs.rm(temp,{force:true}).catch(()=>{}); }
}
export function inferTrigger(items, source) {
  const captions=items.filter(i=>i.caption.trim()),counts=new Map();
  for(const i of captions){const t=i.caption.match(/^(@[^\s,]{1,99}),\s/)?.[1];if(t)counts.set(t,(counts.get(t)||0)+1);}
  const best=[...counts].sort((a,b)=>b[1]-a[1])[0];
  return best && best[1]/captions.length>=0.7?best[0]:path.basename(source);
}
export function sidecar(file) { return file.slice(0,-path.extname(file).length)+'.txt'; }
export class Workspace {
  constructor(root) { this.root=root; this.project=null; this.tail=Promise.resolve(); }
  serialized(fn) { const next=this.tail.then(fn); this.tail=next.catch(()=>{}); return next; }
  async open(folder, recursive = true) {
    const source=await fs.realpath(folder);
    if (!(await fs.stat(source)).isDirectory()) throw new Error('画像フォルダを指定してください');
    const id=createHash('sha256').update(source).digest('hex').slice(0,20);
    const file=path.join(this.root,'projects',id+'.json');
    let old; try { old=JSON.parse(await fs.readFile(file,'utf8')); } catch(e) { if(e.code!=='ENOENT') throw new Error('保存済みプロジェクトを読めません: '+e.message); }
    const found=[];
    async function walk(dir, depth=0) {
      for (const entry of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'ja',{numeric:true}))) {
        if(entry.name.startsWith('.')) continue;
        const full=path.join(dir,entry.name);
        if(entry.isDirectory() && recursive && depth<20) await walk(full,depth+1);
        else if(entry.isFile() && EXTENSIONS.has(path.extname(entry.name).toLowerCase())) found.push(full);
        if(found.length>20000) throw new Error('画像は1プロジェクト20,000枚までです。フォルダを分けてください');
      }
    }
    await walk(source);
    const byPath=new Map((old?.items||[]).map(x=>[x.relative,x]));
    const items=[];
    for(const full of found) {
      const relative=path.relative(source,full), previous=byPath.get(relative);
      const disk=await fs.readFile(sidecar(full),'utf8').catch(e=>{if(e.code==='ENOENT') return ''; throw e;});
      const hasDraft=previous && previous.caption!==previous.savedCaption;
      const caption=hasDraft?previous.caption:disk.trim();
      items.push({id:createHash('sha256').update(relative).digest('hex').slice(0,20),relative,caption,savedCaption:disk.trim(),metadata:previous?.metadata||'',reviewed:previous?.reviewed && previous.caption===caption || false,status:caption?'ready':'empty',error:'',generatedAt:previous?.generatedAt||null,prompt:previous?.prompt||null});
    }
    this.project={id,source,recursive,settings:old?.settings||{...DEFAULT_PROMPT,trigger:inferTrigger(items,source)},items,file};
    await this.persist(); return this.snapshot();
  }
  snapshot() {
    if(!this.project) return null;
    const {file,...project}=this.project;
    return {...project,items:project.items.map(i=>({...i,warnings:lintCaption(i.caption,project.settings),dirty:i.caption!==i.savedCaption}))};
  }
  require() { if(!this.project) throw new Error('先に画像フォルダを開いてください'); return this.project; }
  item(id) { const i=this.require().items.find(i=>i.id===id); if(!i) throw new Error('画像が見つかりません'); return i; }
  async imagePath(id) {
    const p=this.require(), target=await fs.realpath(path.join(p.source,this.item(id).relative));
    if(!target.startsWith(p.source+path.sep)) throw new Error('画像の参照先がフォルダ外に変更されました');
    return target;
  }
  async persist() { const p=this.require(); await atomicWrite(p.file,JSON.stringify(p,null,2)); }
  async update(id, patch) {
    const i=this.item(id);
    for(const key of ['caption','metadata']) if(patch[key]!==undefined) { if(typeof patch[key]!=='string' || patch[key].length>20000) throw new Error('入力が不正です'); i[key]=patch[key]; }
    if(patch.caption!==undefined) { i.reviewed=false;i.error='';i.status=i.caption?'ready':'empty'; }
    if(patch.reviewed!==undefined) i.reviewed=!!patch.reviewed;
    await this.persist();return this.snapshot();
  }
  async settings(input) { this.require().settings=normalizePrompt(input);await this.persist();return this.snapshot(); }
  async writeSidecars(ids) {
    const p=this.require(), chosen=ids.map(id=>this.item(id));
    const counts=new Map();
    for(const i of p.items) { const key=sidecar(i.relative).toLowerCase();counts.set(key,(counts.get(key)||0)+1); }
    const conflicts=chosen.filter(i=>counts.get(sidecar(i.relative).toLowerCase())>1);
    if(conflicts.length) throw new Error('同名で拡張子が異なる画像の.txtが衝突します。画像名を変更してください: '+conflicts.map(i=>i.relative).join(', '));
    const result={written:0,skipped:0,errors:[]};
    for(const i of chosen) {
      try {
        if(!i.caption.trim()) {result.skipped++;continue;}
        const target=sidecar(await this.imagePath(i.id));
        const stat=await fs.lstat(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
        if(stat?.isSymbolicLink()) throw new Error('シンボリックリンクの.txtには書き込みません');
        const disk=stat?await fs.readFile(target,'utf8'):null;
        if(disk!==null && disk.trim()===i.caption.trim()) {i.savedCaption=i.caption;result.skipped++;continue;}
        if(disk!==null && disk.trim()!==i.savedCaption) throw new Error('外部で.txtが変更されました。フォルダを再読込して確認してください');
        if(disk!==null) {
          const backup=path.join(this.root,'backups',p.id,new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,6),sidecar(i.relative));
          await atomicWrite(backup,disk);
        }
        await atomicWrite(target,i.caption.trim()+'\n');i.savedCaption=i.caption;result.written++;
      } catch(e) {result.errors.push({file:i.relative,error:e.message});}
    }
    await this.persist();return result;
  }
}
