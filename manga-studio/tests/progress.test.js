import test from 'node:test';
import assert from 'node:assert/strict';
import {MangaService} from '../src/service.js';
import {startEditor} from '../src/editor-server.js';
import {config,tempRoot,script,bubble} from './fixtures.js';
import {normalizeScript} from '../src/model.js';
import {sessionKey} from '../src/store.js';

test('workflow tracks a live draft, errors, export staleness and restart interruption',async t=>{
  const c=config(await tempRoot('progress'));let finish;
  let service=new MangaService(c,{}, {creative:()=>new Promise(resolve=>finish=resolve)});
  t.after(()=>service.close());const p=service.create('progress',{title:'進捗テスト',brief:'test'});
  const stage=id=>service.progress.snapshot(p.id).stages.find(s=>s.id===id);
  const work=service.draft('progress',{instruction:'test',pageCount:1,revision:1},new AbortController().signal);
  assert.equal(stage('script').state,'running');finish({pages:normalizeScript(script)});await work;
  assert.equal(stage('script').state,'review');service.approve(p.id,2);assert.equal(stage('script').state,'completed');
  await service.export('progress');assert.equal(stage('export').state,'completed');
  service.letter('progress',{pageId:'p1',revision:3,action:'upsert',bubble});assert.equal(stage('export').state,'review');
  await assert.rejects(service.progress.track(p.id,'draft',async()=>{throw Error('模型応答エラー');}),/模型応答/);
  assert.equal(stage('script').state,'failed');assert.match(stage('script').error,/模型応答/);
  service.progress.save(p.id,'draft',{state:'running'});await service.close();service=new MangaService(c,{});
  assert.equal(stage('script').state,'interrupted');assert(service.store.get(p.id).pages.length);
});

test('progress API is session scoped; gallery capability grants read-only overview and editor navigation',async t=>{
  const service=new MangaService(config(await tempRoot('progress-api')),{}),editor=await startEditor(service,0);
  t.after(async()=>{await editor.close();await service.close();});
  const a=service.create('a',{title:'A',brief:'a'}),b=service.create('b',{title:'B',brief:'b'});
  const auth=url=>({Authorization:'Bearer '+new URLSearchParams(new URL(url).hash.slice(1)).get('token')});
  const headers=auth(editor.url(a.id));
  assert.equal((await fetch(`${editor.origin}/api/${a.id}/progress`,{headers})).status,200);
  assert.equal((await fetch(`${editor.origin}/api/${b.id}/progress`,{headers})).status,401);
  const galleryHeaders=auth(editor.progressUrl(a.id,'a'));
  const overview=await(await fetch(`${editor.origin}/api/${a.id}/gallery/progress`,{headers:galleryHeaders})).json();assert.equal(overview.items.length,2);
  assert.equal((await fetch(`${editor.origin}/api/${a.id}/approve`,{method:'POST',headers:{...galleryHeaders,'Content-Type':'application/json'},body:'{"revision":1}'})).status,401);
});

test('media progress reads only owned job status, coalesces polling and retains stale progress on connection loss',async t=>{
  const service=new MangaService(config(await tempRoot('media-progress')),{});t.after(()=>service.close());
  const studios=service.studios,calls=[];
  const a=studios.save('a','media',{provider:'krea',remoteId:'image-a'});
  const b=studios.save('a','media',{provider:'h3',remoteId:'video-a'});
  const done=studios.save('a','media',{provider:'h3',remoteId:'past-a',lastProgress:{state:'completed',ratio:1}});
  studios.save('b','media',{provider:'krea',remoteId:'image-b'});
  studios.request=async(provider,path,options)=>{assert.equal(options.body,undefined);calls.push(path);assert.match(path,/^\/api\/jobs\/(image|video)-a$/);await new Promise(resolve=>setImmediate(resolve));return {status:'running',progress:.2,timing:{overall_percent:50},message:'サンプリング中'};};
  const [first,second]=await Promise.all([studios.mediaProgress(sessionKey('a')),studios.mediaProgress(sessionKey('a'))]);
  assert.equal(calls.length,2);assert.deepEqual(first,second);assert.equal(first.length,3);assert.equal(first.find(x=>x.id===a).ratio,.5);assert.equal(first.find(x=>x.id===done).ratio,1);
  studios.progressCache.get(a).time=0;studios.progressCache.get(b).time=0;
  studios.request=async()=>{throw Error('studio offline');};
  const offline=await studios.mediaProgress(sessionKey('a'));assert.equal(offline.find(x=>x.id===a).ratio,.5);assert.match(offline.find(x=>x.id===a).connectionError,/前回の進捗/);
  studios.progressCache.get(a).time=0;studios.progressCache.get(b).time=0;
  studios.request=async()=>({status:'completed',progress:.2});
  const complete=await studios.mediaProgress(sessionKey('a'));assert(complete.every(x=>x.ratio===1&&x.state==='completed'&&!x.connectionError));
  studios.request=async()=>{throw Error('completed jobs must not be polled');};assert.deepEqual(await studios.mediaProgress(sessionKey('a')),complete);
});
