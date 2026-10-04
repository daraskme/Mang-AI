import { createServer } from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { packageRoot } from './config.js';
import { letteringWarnings } from './render.js';
import { MediaGallery } from './gallery.js';

const staticFiles = {
  '/':['public/index.html','text/html; charset=utf-8'],
  '/editor.js':['public/editor.js','text/javascript; charset=utf-8'],
  '/style.css':['public/style.css','text/css; charset=utf-8'],
  '/render.js':['src/render.js','text/javascript; charset=utf-8'],
  '/model.js':['src/model.js','text/javascript; charset=utf-8'],
  '/media.html':['public/media.html','text/html; charset=utf-8'],
  '/media.js':['public/media.js','text/javascript; charset=utf-8'],
  '/media.css':['public/media.css','text/css; charset=utf-8'],
  '/generate.html':['public/generate.html','text/html; charset=utf-8'],
  '/generate.js':['public/generate.js','text/javascript; charset=utf-8'],
  '/gallery.html':['public/gallery.html','text/html; charset=utf-8'],
  '/gallery.js':['public/gallery.js','text/javascript; charset=utf-8'],
  '/gallery.css':['public/gallery.css','text/css; charset=utf-8'],
};
async function streamFile(req,res,file) {
  res.setHeader('Content-Type',file.type);
  if(file.bytes){res.end(file.bytes);return;}
  const {size}=await stat(file.path);res.setHeader('Accept-Ranges','bytes');
  let start=0,end=size-1;
  if(req.headers.range){
    const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if(!range||(!range[1]&&!range[2])){res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return;}
    if(!range[1])start=Math.max(0,size-Number(range[2]));
    else {start=Number(range[1]);if(range[2])end=Math.min(Number(range[2]),end);}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return;}
    res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);
  }
  res.setHeader('Content-Length',Math.max(0,end-start+1));
  if(size===0){res.end();return;}
  await pipeline(createReadStream(file.path,{start,end}),res);
}
async function jsonBody(req) {
  if(!req.headers['content-type']?.startsWith('application/json')) throw new Error('JSON を送信してください');
  let size=0;const chunks=[];
  for await(const chunk of req) {size+=chunk.length;if(size>10*1024*1024) throw new Error('リクエストが大きすぎます');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/** Loopback-only editor with unguessable, session-scoped bearer capabilities. */
export async function startEditor(service, port) {
  const secret=randomBytes(32);
  const token=id=>createHmac('sha256',secret).update(id).digest('hex');
  const generationSessions=new Map();
  const gallery=new MediaGallery(service),gallerySessions=new Map();
  let origin;
  const galleryUrl=(id,session)=>{gallerySessions.set(id,session);return `${origin}/gallery.html#project=${id}&token=${token('gallery:'+id)}`;};
  const server=createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    try {
      if(req.headers.host!==new URL(origin).host || (req.headers.origin && req.headers.origin!==origin)) {send(403,{error:'接続元が一致しません'});return;}
      const url=new URL(req.url,origin);
      if(req.method==='GET' && staticFiles[url.pathname]) {
        const [file,type]=staticFiles[url.pathname];res.setHeader('Content-Type',type);res.end(await readFile(join(packageRoot,file)));return;
      }
      const match=/^\/api\/([a-f0-9]{32})(?:\/(.*))?$/.exec(url.pathname);
      if(!match) {send(404,{error:'見つかりません'});return;}
      const [,id,action='']=match,credential=(req.headers.authorization||'').replace(/^Bearer /,'')||(req.method==='GET'&&/^edit\/[a-f0-9-]+\/file$/.test(action)?url.searchParams.get('token')||'':'');
      if(action.startsWith('gallery/')) {
        const verb=action.slice(8),expected=token('gallery:'+id);
        const supplied=credential||(req.method==='GET'&&/^(file|thumb)\/[a-f0-9]{32}$/.test(verb)?url.searchParams.get('token')||'':'');
        if(!gallerySessions.has(id)||Buffer.byteLength(supplied)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))){send(401,{error:'Mang-AIのメディアギャラリーから開いてください'});return;}
        if(req.method==='GET'&&verb==='collections'){send(200,{items:await gallery.catalog()});return;}
        if(req.method==='GET'&&verb==='items'){send(200,await gallery.list(url.searchParams.get('collection'),{offset:Number(url.searchParams.get('offset')||0),limit:48,query:url.searchParams.get('query')||''}));return;}
        const asset=/^(detail|file|thumb)\/([a-f0-9]{32})$/.exec(verb);
        if(req.method==='GET'&&asset){if(asset[1]==='detail')send(200,await gallery.detail(asset[2]));else await streamFile(req,res,await gallery.file(asset[2],asset[1]==='thumb'));return;}
        if(req.method==='POST'&&verb==='open'){
          const args=await jsonBody(req),a=gallery.get(args.id);
          if(a.projectId){service.store.get(a.projectId);send(200,{url:`${origin}/#project=${a.projectId}&token=${token(a.projectId)}&page=${a.pageId}`});}
          else {
            const session=gallerySessions.get(id),item=await service.edits.open(session,{path:(await gallery.file(a.id)).path},AbortSignal.timeout(60000));
            // Import a copy into the gallery's editing session; originals remain intact.
            const {sessionKey}=await import('./store.js'),project=sessionKey(session);
            send(200,{url:`${origin}/media.html#project=${project}&asset=${item.id}&token=${token(project)}`});
          }
          return;
        }
        send(404,{error:'ギャラリー操作がありません'});return;
      }
      const expected=token(id);
      if(Buffer.byteLength(credential)!==Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(credential),Buffer.from(expected))) {send(401,{error:'DSH の manga_open_editor から編集画面を開いてください'});return;}
      if(req.method==='GET'&&action==='gallery'){send(200,{url:galleryUrl(id,generationSessions.get(id)||service.store.find(id)?.sessionId||'gallery')});return;}
      if(action.startsWith('generate/')) {
        const session=generationSessions.get(id);
        if(!session){send(403,{error:'エージェントの media_open_generator から開き直してください'});return;}
        const verb=action.slice(9),signal=AbortSignal.timeout(120000);
        if(req.method==='GET'&&verb==='history') {
          const rows=service.store.db.prepare("SELECT id,body FROM integrations WHERE session=? AND kind='media' ORDER BY rowid DESC LIMIT 50").all(id);
          send(200,rows.map(row=>({id:row.id,...JSON.parse(row.body)})));return;
        }
        if(req.method!=='POST'){send(405,{error:'POST が必要です'});return;}
        const args=await jsonBody(req);
        if(verb==='status')send(200,await service.studios.status(args.provider,signal));
        else if(verb==='library')send(200,await service.studios.library(args));
        else if(verb==='service')send(200,await service.studios.control(args.provider,args.action,signal));
        else if(verb==='plan')send(200,service.studios.planLongVideo(args));
        else if(verb==='submit'){const {provider,...params}=args;send(200,await service.studios.generate(session,provider,params,signal));}
        else if(verb==='job')send(200,await service.studios.job(session,args.id,args.action,signal));
        else if(verb==='upscale')send(200,await service.studios.upscale(session,args,signal));
        else send(404,{error:'生成操作がありません'});
        return;
      }
      if(action.startsWith('edit/')) {
        const parts=action.split('/'),assetId=parts[1];
        if(req.method==='GET') {
          if(assetId==='job'){send(200,service.edits.get(id,parts[2],'edit-job'));return;}
          const asset=service.edits.get(id,assetId);
          if(parts[2]==='file') {
            const path=service.edits.path(id,asset,url.searchParams.get('version')||asset.current);
            const mime=path.endsWith('.mp4')?'video/mp4':path.endsWith('.webp')?'image/webp':/\.jpe?g$/.test(path)?'image/jpeg':'image/png';
            const {size}=await stat(path);res.setHeader('Content-Type',mime);res.setHeader('Accept-Ranges','bytes');
            let start=0,end=size-1;
            if(req.headers.range) {
              const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
              if(!range){send(416,{error:'Range が不正です'});return;}
              start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),size-1):size-1;
              if(start>end||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return;}
              res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);
            }
            res.setHeader('Content-Length',end-start+1);await pipeline(createReadStream(path,{start,end}),res);return;
          }
          send(200,{...asset,jobs:service.edits.jobs(id,assetId)});return;
        }
        if(req.method!=='POST'){send(405,{error:'POST が必要です'});return;}
        const args=await jsonBody(req);
        if(assetId==='run')send(200,service.edits.enqueue(id,args));
        else if(assetId==='select')send(200,service.edits.select(id,args));
        else if(assetId==='commit')send(200,await service.edits.commit(id,args));
        else if(assetId==='cancel')send(200,service.edits.cancel(id,args.jobId));
        else send(404,{error:'編集操作がありません'});
        return;
      }
      const p=service.store.get(id);
      if(req.method==='GET' && !action) {send(200,{project:p,jobs:service.store.jobs(id),warnings:letteringWarnings(p)});return;}
      if(req.method==='GET' && action.startsWith('images/')) {
        if(!p.pages.some(page=>page.panels.some(panel=>panel.image===action))) {send(404,{error:'現在の作品に属する画像ではありません'});return;}
        res.setHeader('Content-Type','image/png');res.end(await service.readImage(id,action));return;
      }
      if(req.method!=='POST') {send(405,{error:'対応していない操作です'});return;}
      const args=await jsonBody(req);
      if(action==='open-edit') {
        const asset=await service.edits.open(p.sessionId,args,AbortSignal.timeout(60000));
        send(200,{asset,url:`${origin}/media.html#project=${id}&asset=${asset.id}&token=${expected}`});
      }
      else if(action==='letter') send(200,service.letter(p.sessionId,args));
      else if(action==='approve') send(200,{project:service.approve(id,args.revision)});
      else if(action==='script') send(200,{project:service.setScript(p.sessionId,args)});
      else if(action==='render') send(200,{job:await service.render(p.sessionId,args)});
      else if(action==='cancel') send(200,{job:service.cancel(p.sessionId,args.jobId)});
      else if(action==='export') send(200,await service.export(p.sessionId));
      else send(404,{error:'未対応の操作です'});
    } catch(error) {if(!res.headersSent) send(error.status||400,{error:error.message});else res.destroy(error);}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  return {
    url: id=>`${origin}/#project=${id}&token=${token(id)}`,
    mediaUrl: (id,asset)=>`${origin}/media.html#project=${id}&asset=${asset}&token=${token(id)}`,
    generationUrl: (id,session)=>{generationSessions.set(id,session);return `${origin}/generate.html#project=${id}&token=${token(id)}`;},
    galleryUrl,
    origin,
    close:()=>{gallery.close();return new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeIdleConnections();});},
  };
}
