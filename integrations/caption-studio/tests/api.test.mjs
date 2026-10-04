import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createApp}from'../server.mjs';
test('API requires authentication and rejects foreign origins; sidecars load with image access',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'krea-api-'));const app=await createApp({port:0,dataRoot:path.join(dir,'state')});t.after(async()=>{await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true,force:true});});
  assert.equal((await fetch(app.url+'/api/state')).status,403);
  const headers={'X-Studio-Token':app.token,'Content-Type':'application/json'};
  assert.equal((await fetch(app.url+'/api/state',{headers:{...headers,Origin:'https://unrelated.example'}})).status,403);
  const images=path.join(dir,'images');await fs.mkdir(images);await fs.copyFile(new URL('../examples/demo/vase_01.png',import.meta.url),path.join(images,'vase.png'));await fs.writeFile(path.join(images,'vase.txt'),'@vase, a flower pot.');
  const r=await fetch(app.url+'/api/open',{method:'POST',headers,body:JSON.stringify({folder:images,recursive:true})});assert.equal(r.status,200);const p=await r.json();assert.equal(p.items.length,1);assert.equal(p.items[0].caption,'@vase, a flower pot.');
  const image=await fetch(app.url+'/image/'+p.items[0].id+'?token='+app.token);assert.equal(image.headers.get('content-type'),'image/png');assert.equal((await fetch(app.url+'/image/'+p.items[0].id)).status,403);
  const conflict=await fetch(app.url+'/api/item',{method:'POST',headers,body:JSON.stringify({id:p.items[0].id,caption:'wrong folder',expectedProjectId:'different-project'})});
  assert.equal(conflict.status,400);
  assert.equal(app.workspace.item(p.items[0].id).caption,'@vase, a flower pot.');
});
