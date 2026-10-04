import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MangaService } from '../src/service.js';
import { startEditor } from '../src/editor-server.js';
import { sessionKey } from '../src/store.js';
import { config, tempRoot, script, png } from './fixtures.js';

async function fixture(t) {
  const root=await tempRoot('edits'),c=config(root),s=new MangaService(c,{}),source=join(root,'input.png');
  await writeFile(source,png);
  s.edits.worker=async request=>{
    if(request.mode==='info')return {kind:'image',width:1,height:1};
    await copyFile(request.source,request.output);return {width:1,height:1};
  };
  t.after(async()=>{if(!s.closed)await s.close();await rm(root,{recursive:true,force:true});});
  return {root,c,s,source,owner:sessionKey('alice')};
}

test('standalone edits retain original bytes, isolate sessions and serve authenticated byte ranges',async t=>{
  const {s,source,owner}=await fixture(t),asset=await s.edits.open('alice',{path:source});
  const editor=await startEditor(s,0);t.after(()=>editor.close());
  const token=new URLSearchParams(new URL(editor.mediaUrl(owner,asset.id)).hash.slice(1)).get('token');
  const base=`${editor.origin}/api/${owner}/edit/${asset.id}`;
  assert.equal((await fetch(base)).status,401);
  assert.equal((await fetch(base+'?token='+token)).status,401);
  const partial=await fetch(base+'/file?token='+token,{headers:{Range:'bytes=1-8'}});
  assert.equal(partial.status,206);assert.equal(partial.headers.get('content-range'),`bytes 1-8/${png.length}`);
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()),png.subarray(1,9));
  assert.equal((await fetch(base+'/file?token='+token,{headers:{Range:'bytes=999999-'}})).status,416);
  const bob=sessionKey('bob'),otherToken=new URLSearchParams(new URL(editor.url(bob)).hash.slice(1)).get('token');
  assert.equal((await fetch(`${editor.origin}/api/${bob}/edit/${asset.id}`,{headers:{Authorization:`Bearer ${otherToken}`}})).status,400);
  assert.throws(()=>s.edits.get(bob,asset.id),/このセッション/);
  const job=s.edits.enqueue(owner,{assetId:asset.id,revision:1,mode:'mosaic',regions:[{x:0,y:0,width:1,height:1}]});
  await s.edits.tail;
  const edited=s.edits.get(owner,asset.id);assert.equal(edited.current,job.id);assert.equal(edited.versions.length,2);
  assert.deepEqual(await readFile(s.edits.path(owner,edited,'original')),png);
  assert.deepEqual(await readFile(source),png);
  assert.throws(()=>s.edits.select(owner,{assetId:asset.id,revision:1,version:'original'}),/変わって/);
  const restored=s.edits.select(owner,{assetId:asset.id,revision:edited.revision,version:'original'});
  assert.equal(restored.current,'original');assert.equal(s.edits.jobs(owner,asset.id)[0].status,'completed');
  assert.equal((await s.edits.commit(owner,{assetId:asset.id,revision:restored.revision})).outputPath,s.edits.path(owner,restored));
});

test('finishing a job never replaces a newer selection; cancellation retains history and original',async t=>{
  const {s,source,owner}=await fixture(t),asset=await s.edits.open('alice',{path:source});
  let release;const finish=new Promise(resolve=>release=resolve),worker=s.edits.worker;
  s.edits.worker=async request=>{await finish;return worker(request);};
  const job=s.edits.enqueue(owner,{assetId:asset.id,revision:1,mode:'mosaic'});
  assert.throws(()=>s.edits.enqueue(owner,{assetId:asset.id,revision:1,mode:'mosaic'}),/処理中/);
  s.edits.select(owner,{assetId:asset.id,revision:1,version:'original'});
  release();await s.edits.tail;
  const selected=s.edits.get(owner,asset.id);assert.equal(selected.current,'original');assert.equal(selected.versions.length,2);
  assert.equal(s.edits.get(owner,job.id,'edit-job').superseded,true);
  s.edits.worker=async(_request,signal)=>{await new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true});});signal.throwIfAborted();};
  const cancelled=s.edits.enqueue(owner,{assetId:asset.id,revision:selected.revision,mode:'inpaint'});
  await new Promise(resolve=>setImmediate(resolve));s.edits.cancel(owner,cancelled.id);await s.edits.tail;
  assert.equal(s.edits.get(owner,cancelled.id,'edit-job').status,'cancelled');
  assert.equal(s.edits.get(owner,asset.id).versions.length,2);
});

test('comic commit retains originals and refuses to replace a regenerated panel',async t=>{
  const {s,source,owner}=await fixture(t);let p=s.create('alice',{title:'test',brief:'test'});p=s.setScript('alice',{script,revision:p.revision});
  await mkdir(join(s.store.directory(owner),'images'));
  const original=`images/p1-c1-${randomUUID()}.png`;await copyFile(source,join(s.store.directory(owner),original));
  p=s.store.update(owner,p.revision,p=>p.pages[0].panels[0].image=original);
  const a=await s.edits.open('alice',{pageId:'p1',panelId:'p1-c1'}),b=await s.edits.open('alice',{pageId:'p1',panelId:'p1-c1'});
  const committed=await s.edits.commit(owner,{assetId:a.id,revision:1});
  assert.notEqual(committed.project.pages[0].panels[0].image,original);
  assert.deepEqual(await readFile(join(s.store.directory(owner),original)),png);
  await assert.rejects(s.edits.commit(owner,{assetId:b.id,revision:1}),/元のコマが更新/);
});

test('restart marks unfinished edits interrupted without changing selected versions',async t=>{
  const {s,c,source,owner}=await fixture(t),asset=await s.edits.open('alice',{path:source});
  const id=randomUUID();s.edits.put(owner,'edit-job',{id,assetId:asset.id,status:'running'});
  await s.close();const reopened=new MangaService(c,{});
  try{assert.equal(reopened.edits.get(owner,id,'edit-job').status,'interrupted');assert.equal(reopened.edits.get(owner,asset.id).current,'original');}
  finally{await reopened.close();}
});
