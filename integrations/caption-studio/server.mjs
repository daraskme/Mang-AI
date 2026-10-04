import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Workspace,EXTENSIONS} from './lib/storage.mjs';
import {Engine,Jobs} from './lib/engine.mjs';
import {Training} from './lib/training.mjs';
import {BulkEdits} from './lib/bulk.mjs';
import {PRESETS,SOURCES,buildPrompt} from './lib/prompts.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
export async function createApp({dataRoot=path.join(HERE,'.caption-studio'),port=Number(process.env.PORT||3210)}={}) {
  const workspace=new Workspace(dataRoot),engine=new Engine(dataRoot);await engine.init();
  const jobs=new Jobs(workspace,engine),training=new Training(HERE,workspace,engine,jobs),bulk=new BulkEdits(workspace),token=randomBytes(24).toString('hex');
  await training.init();
  const json=(res,data,code=200)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  async function body(req) {let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>1024*1024)throw new Error('リクエストが大きすぎます');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
  const server=http.createServer(async(req,res)=>{
    try {
      const address=server.address(),allowed=new Set([`127.0.0.1:${address.port}`,`localhost:${address.port}`]);
      if(!allowed.has(req.headers.host))return json(res,{error:'Invalid host'},403);
      if(req.headers.origin && ![`http://127.0.0.1:${address.port}`,`http://localhost:${address.port}`].includes(req.headers.origin))return json(res,{error:'Invalid origin'},403);
      res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
      const url=new URL(req.url,'http://127.0.0.1'),route=url.pathname;
      if(route.startsWith('/api/')) {
        if(req.headers['x-studio-token']!==token)return json(res,{error:'この画面を再読み込みしてください'},403);
        const b=req.method==='POST'?await body(req):{};
        const checkProject=()=>{if(b.expectedProjectId && workspace.snapshot()?.id!==b.expectedProjectId)throw new Error('画像フォルダが変更されています。開き直してください');};
        const change=fn=>workspace.serialized(()=>{checkProject();return fn();});
        if(req.method==='POST')checkProject();
        if(route==='/api/bootstrap')return json(res,{presets:PRESETS,sources:SOURCES,checkedAt:'2026-10-01',project:workspace.snapshot(),engine:await engine.status(),job:jobs.current,dataRoot});
        if(route==='/api/training/defaults')return json(res,await training.defaults(url.searchParams.has('count')?Number(url.searchParams.get('count')):undefined));
        if(route==='/api/training/status')return json(res,training.status());
        if(route==='/api/state')return json(res,{project:workspace.snapshot(),job:jobs.current});
        if(route==='/api/engine/status')return json(res,await engine.status());
        if(route==='/api/browse') {
          const dir=await fs.realpath(url.searchParams.get('path')||os.homedir());
          const entries=await fs.readdir(dir,{withFileTypes:true});
          return json(res,{path:dir,parent:path.dirname(dir),folders:entries.filter(e=>e.isDirectory()&&!e.name.startsWith('.')).map(e=>e.name).sort((a,b)=>a.localeCompare(b,'ja')),images:entries.filter(e=>e.isFile()&&EXTENSIONS.has(path.extname(e.name).toLowerCase())).length});
        }
        if(route==='/api/prompt')return json(res,{prompt:buildPrompt(workspace.require().settings,url.searchParams.get('id')?workspace.item(url.searchParams.get('id')).metadata:'')});
        if(route==='/api/manifest') {const p=workspace.require();res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Content-Disposition':'attachment; filename="captions.jsonl"'});return res.end(p.items.filter(i=>i.caption.trim()).map(i=>JSON.stringify({file_name:i.relative,text:i.caption,reviewed:i.reviewed})).join('\n')+'\n');}
        if(req.method!=='POST')return json(res,{error:'Not found'},404);
        if(route==='/api/bulk/preview')return json(res,bulk.plan(b));
        if(route==='/api/bulk/apply'){if(jobs.active())throw new Error('生成を停止してから一括編集してください');return json(res,await workspace.serialized(()=>bulk.apply(b.id)));}
        if(route==='/api/training/prepare')return json(res,await training.prepare(b.config,b.ids||[]));
        if(route==='/api/training/start')return json(res,await training.start(b.id));
        if(route==='/api/training/stop'){if(b.expectedTrainingId && training.status()?.id!==b.expectedTrainingId)throw new Error('別の学習を停止できません');training.stop();return json(res,{ok:true});}
        if(route==='/api/open') {if(jobs.active()||training.launching)throw new Error('データ準備・生成を停止してからフォルダを変更してください');return json(res,await workspace.serialized(()=>workspace.open(b.folder,!!b.recursive)));}
        if(route==='/api/settings') {if(jobs.active())throw new Error('生成を停止してから方針を変更してください');const {expectedProjectId,...settings}=b;return json(res,await change(()=>workspace.settings(settings)));}
        if(route==='/api/item')return json(res,await change(()=>workspace.update(b.id,b)));
        if(route==='/api/save')return json(res,await change(()=>workspace.writeSidecars(b.ids||[])));
        if(route==='/api/job/start'){if(training.active())throw new Error('LoRA学習が実行中です');return json(res,await jobs.start(b.ids||[],!!b.overwrite));}
        if(route==='/api/job/stop'){if(b.expectedJobStartedAt && jobs.current?.startedAt!==b.expectedJobStartedAt)throw new Error('別の生成ジョブを停止できません');jobs.stop();return json(res,{ok:true});}
        if(route==='/api/engine/config'){if(jobs.active())throw new Error('生成中は設定できません');await engine.configure(b);return json(res,await engine.status());}
        if(route==='/api/engine/start'){if(training.active())throw new Error('LoRA学習が実行中です');await engine.start();return json(res,{ok:true});}
        if(route==='/api/engine/stop'){if(jobs.active())throw new Error('生成を先に停止してください');engine.stop();return json(res,{ok:true});}
        return json(res,{error:'Not found'},404);
      }
      if(route.startsWith('/image/')) {
        if(url.searchParams.get('token')!==token)return json(res,{error:'Unauthorized'},403);
        const file=await workspace.imagePath(route.slice(7)),image=await fs.readFile(file);
        res.writeHead(200,{'Content-Type':EXTENSIONS.get(path.extname(file).toLowerCase()),'Cache-Control':'private, max-age=60'});return res.end(image);
      }
      if(!['/','/app.js','/extensions.js','/style.css','/icon.svg'].includes(route))return json(res,{error:'Not found'},404);
      const file=path.join(HERE,'public',route==='/'?'index.html':route.slice(1));
      let content=await fs.readFile(file,'utf8');if(route==='/')content=content.replace('__TOKEN__',token);
      res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      res.writeHead(200,{'Content-Type':route.endsWith('.js')?'text/javascript; charset=utf-8':route.endsWith('.css')?'text/css; charset=utf-8':route.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(content);
    }catch(e){if(!res.headersSent)json(res,{error:e.message},400);else res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,workspace,engine,jobs,training,token,url:`http://127.0.0.1:${server.address().port}`};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=await createApp();console.log(`Krea Caption Studio: ${app.url}`);
  const stop=()=>{app.jobs.stop();app.training.stop();if(app.engine.child)app.engine.stop();app.server.close();setTimeout(()=>process.exit(),5500).unref();};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
