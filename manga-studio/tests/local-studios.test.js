import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { MangaService } from '../src/service.js';
import { LocalStudios } from '../src/local-studios.js';
import { config,tempRoot,png,script } from './fixtures.js';

async function fixture(t) {
  const root=await tempRoot('studios'),c=config(root),store=new Store(root),requests=[];
  let project={id:'dataset',source:root,settings:{mode:'character',trigger:'sample'},items:[1,2,3].map(n=>({id:String(n),caption:'sample, a vase.',reviewed:true,relative:n+'.png'}))};
  let training=null,captionJob=null,cancelled=false,engine='ready',kreaState='completed';
  const server=http.createServer(async(req,res)=>{
    try {
      const bytes=[];for await(const b of req)bytes.push(b);
      let body;const raw=Buffer.concat(bytes);
      if(raw.length && req.headers['content-type']==='application/json')body=JSON.parse(raw);
      requests.push({url:req.url,body,headers:req.headers,raw});
      const send=(value,code=200)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
      if(req.url==='/'){res.end('<meta name="studio-token" content="abcdef">');return;}
      if(req.url==='/health')return send({ok:true});
      if(req.url==='/api/inventory')return send({loras:[{name:'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors'}]});
      if(req.url==='/outputs/image.png'){res.end(png);return;}
      if(req.url==='/api/jobs/video-1/file/video'){res.end('video-fixture');return;}
      if(req.url==='/api/generate')return send({job_id:'image-1',status:'queued'},202);
      if(req.url==='/api/uploads')return send({id:'upload.png'});
      if(req.url==='/api/jobs'&&req.method==='POST')return send({id:'video-1',status:'queued'},201);
      if(req.url==='/api/jobs/image-1/cancel'){cancelled=true;return send({status:'cancelled'});}
      if(req.url==='/api/jobs/image-1')return send({status:kreaState,result:{image_url:'/outputs/image.png'}});
      if(req.url==='/api/jobs/video-1')return send({status:'completed',output_url:'/api/jobs/video-1/file/video'});
      if(req.headers['x-studio-token']!=='abcdef')return send({error:'token'},403);
      if(body?.expectedProjectId && body.expectedProjectId!==project.id)return send({error:'wrong project'},409);
      if(req.url==='/api/open')return send(project);
      if(req.url==='/api/state')return send({project,job:captionJob});
      if(req.url==='/api/engine/status')return send({health:engine});
      if(req.url==='/api/engine/start'){engine='loading';return send({ok:true});}
      if(req.url==='/api/job/start'){captionJob={state:'running',startedAt:100,total:body.ids.length};return send(captionJob);}
      if(req.url==='/api/job/stop'){captionJob.state='cancelled';return send({ok:true});}
      if(req.url==='/api/item'){Object.assign(project.items.find(i=>i.id===body.id),body);return send(project);}
      if(req.url==='/api/settings'){project.settings=body;return send(project);}
      if(req.url==='/api/save')return send({written:body.ids.length});
      if(req.url==='/api/training/defaults')return send({settings:{steps:300,rank:32}});
      if(req.url==='/api/training/prepare')return send({id:'train-1',run:join(root,'run'),trigger:'sample'});
      if(req.url==='/api/training/start'){training={id:'train-1',state:'running'};return send(training);}
      if(req.url==='/api/training/status')return send(training);
      send({error:req.url},404);
    }catch(e){res.writeHead(500);res.end(e.message);}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const role of ['krea','h3','caption'])c[role]={...c[role],baseURL:base};
  c.krea.pollMs=5;c.krea.loraDir=join(root,'loras');
  const studios=new LocalStudios(c,store,{});
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));store.close();});
  return {root,c,store,studios,requests,base,setProject:p=>project=p,setEngine:s=>engine=s,setKrea:s=>kreaState=s,setTraining:s=>training=s,cancelled:()=>cancelled};
}

test('Krea and H3 jobs survive adapter restart, isolate sessions, upload reference frames',async t=>{
  const f=await fixture(t),image=await f.studios.generate('alice','krea',{prompt:'A quiet lake.'});
  assert.equal(f.requests.find(r=>r.url==='/api/generate').body.model_id,'krea2-turbo-official');
  const reopened=new LocalStudios(f.c,f.store,{});
  const completed=await reopened.job('alice',image.id);
  assert.match(completed.outputUrl,/outputs\/image.png$/);assert.deepEqual(await readFile(completed.outputPath),png);
  await assert.rejects(reopened.job('bob',image.id),/このセッション/);
  const source=join(f.root,'frame.png');await writeFile(source,png);
  const video=await reopened.generate('alice','h3',{prompt:'A leaf moves.',firstFramePath:source});
  const request=f.requests.find(r=>r.url==='/api/jobs').body;
  assert.equal(request.first_frame,'upload.png');assert.equal(request.frames,124);
  assert.equal(request.preset,'turbo8');assert.equal(request.steps,8);assert.equal(request.loras.length,1);
  assert.ok(!('firstFramePath' in request));assert.match((await reopened.job('alice',video.id)).outputUrl,/file\/video$/);
  await assert.rejects(reopened.request('krea','https://example.com/image'),/別ホスト/);
});

test('manga page uses the installed Krea API and collects real PNG bytes',async t=>{
  const f=await fixture(t);f.c.dataDir=join(f.root,'manga');f.c.krea.backend='studio';
  const service=new MangaService(f.c,{});t.after(()=>service.close());
  let p=service.create('alice',{title:'test',brief:'test'});
  p=service.setScript('alice',{script,revision:p.revision});service.approve(p.id,p.revision);
  const job=await service.render('alice',{pageId:'p1'});await service.queue;
  assert.equal(service.store.getJob(job.id).status,'completed');
  assert.equal(service.status('alice').project.pages[0].panels.filter(p=>p.image).length,3);
  assert.equal(f.requests.filter(r=>r.url==='/api/generate').length,3);
  assert(f.requests.filter(r=>r.url==='/api/generate').every(r=>r.body.model_id==='krea2-turbo-official'));
});

test('queued manga rendering retains the selected checkpoint and LoRA independently of later defaults',async t=>{
  const f=await fixture(t);f.c.dataDir=join(f.root,'manga');f.c.krea.backend='studio';
  const service=new MangaService(f.c,{});t.after(()=>service.close());
  let p=service.create('alice',{title:'test',brief:'test'});
  p=service.setScript('alice',{script,revision:p.revision});service.approve(p.id,p.revision);
  let release;service.queue=new Promise(resolve=>release=resolve);
  const loras=[{id:'user/style/test.safetensors',weight:0.5}];
  const job=await service.render('alice',{pageId:'p1',model_id:'kroma-v03-turbo',preset:'turbo8',loras});
  loras[0].weight=0;f.c.krea.model='another-model';f.c.krea.loras=[];
  release();await service.queue;
  assert.equal(service.store.getJob(job.id).status,'completed');
  const sent=f.requests.filter(r=>r.url==='/api/generate');assert.equal(sent.length,3);
  for(const {body} of sent){assert.equal(body.model_id,'kroma-v03-turbo');assert.equal(body.preset,'turbo8');assert.equal(body.loras[0].weight,0.5);}
  assert.equal(service.store.getJob(job.id).generation.model_id,'kroma-v03-turbo');
});

test('cancelling API rendering also cancels its remote job',async t=>{
  const f=await fixture(t);f.setKrea('generating');const abort=new AbortController();
  await assert.rejects(f.studios.renderKrea({prompt:'Lake',output:join(f.root,'cancel.png')},abort.signal,()=>abort.abort()));
  assert.equal(f.cancelled(),true);
});

test('caption defaults preserve existing text, require matching dataset, and training installs without overwriting',async t=>{
  const f=await fixture(t),s=f.studios;
  await s.captionOpen('alice',{folder:f.root,settings:{trigger:'sample'}});
  await s.captionOpen('bob',{folder:f.root});
  assert.equal((await s.captionStatus('alice')).total,3);
  await s.captionAction('alice','generate');
  assert.equal(f.requests.find(r=>r.url==='/api/job/start').body.overwrite,undefined);
  await assert.rejects(s.captionAction('bob','stop'),/このセッション/);
  await s.captionAction('alice','stop');
  assert.equal(f.requests.find(r=>r.url==='/api/job/stop').body.expectedJobStartedAt,100);
  await s.captionAction('alice','edit',{id:'1',caption:'sample, a blue vase.'});
  assert.equal((await s.captionAction('alice','save')).written,3);
  const plan=await s.prepareTraining('alice',{config:{steps:1}});
  assert.equal(f.requests.find(r=>r.url==='/api/training/prepare').body.config.steps,1);
  await assert.rejects(s.training('bob',plan.id,'start'),/このセッション/);
  assert.equal((await s.training('alice',plan.id,'start')).state,'running');
  const artifact=join(f.root,'trained.safetensors');await writeFile(artifact,'fixture');
  f.setTraining({id:'train-1',state:'completed',trigger:'sample',artifacts:[artifact]});
  const installed=await s.installLora('alice',{id:plan.id,name:'sample'});
  assert.equal(await readFile(installed.path,'utf8'),'fixture');
  await assert.rejects(s.installLora('alice',{id:plan.id,name:'sample'}),/EEXIST/);
  f.setProject({id:'other'});
  await assert.rejects(s.captionAction('alice','save'),/変わりました/);
});
