import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createApp} from '../server.mjs';
const execute=promisify(execFile);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const python=process.env.MANGAI_CAPTION_PYTHON||path.join(root,'runtime/python-run');

test('AVIF loads with captions, serves AVIF, sends PNG, and stages training AVIF',
  {skip: !existsSync(python) && 'Set MANGAI_CAPTION_PYTHON to Python with Pillow AVIF and Musubi dependencies'},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'avif-integration-'));
  const images=path.join(dir,'images');await fs.mkdir(images);
  await execute(python,['-c',`from PIL import Image
from pathlib import Path
import sys
p=Path(sys.argv[1])
for i in range(3):
 Image.new('RGB',(32+i,24),(40,100,180)).save(p/f'{i}.AVIF',quality=95)
 (p/f'{i}.txt').write_text('@fixture, a blue rectangle.')
`,images]);
  const app=await createApp({port:0,dataRoot:path.join(dir,'state')});
  let received;
  const backend=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);
    received=JSON.parse(Buffer.concat(chunks));
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({choices:[{message:{content:'@fixture, a blue rectangle.'}}]}));
  });
  await new Promise(r=>backend.listen(0,'127.0.0.1',r));
  t.after(async()=>{
    clearInterval(app.engine.idleTimer);
    await Promise.all([app.server,backend].map(s=>new Promise(r=>s.close(r))));
    await fs.rm(dir,{recursive:true,force:true});
  });
  const project=await app.workspace.open(images);
  assert.equal(project.items.length,3);
  assert.ok(project.items.every(x=>x.caption==='@fixture, a blue rectangle.'));
  const item=project.items[0];
  const response=await fetch(app.url+'/image/'+item.id+'?token='+app.token);
  assert.equal(response.headers.get('content-type'),'image/avif');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),await fs.readFile(path.join(images,item.relative)));
  app.engine.config.port=backend.address().port;
  const result=await app.engine.caption(path.join(images,item.relative),project.settings,'',new AbortController().signal);
  assert.match(result.caption,/blue rectangle/);
  const url=received.messages[0].content[0].image_url.url;
  assert.ok(url.startsWith('data:image/png;base64,'));
  assert.deepEqual(Buffer.from(url.split(',')[1],'base64').subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
  const run=path.join(dir,'training');
  app.training.plan={id:'fixture',run,ids:project.items.map(x=>x.id),
    fingerprint:await app.training.fingerprint(project.items),trigger:'@fixture',config:{resolution:1024,batchSize:1,steps:1}};
  app.training.run=async()=>{app.training.current.state='completed';};
  await app.training.start('fixture');
  for(let i=1;i<=3;i++){
    const stem=String(i).padStart(6,'0');
    assert.ok((await fs.stat(path.join(run,'dataset',stem+'.avif'))).size>0);
    assert.equal((await fs.readFile(path.join(run,'dataset',stem+'.txt'),'utf8')).trim(),'@fixture, a blue rectangle.');
  }
  await execute(python,['-c',`import sys
from PIL import Image
from musubi_tuner.dataset.media_utils import glob_images
files=glob_images(sys.argv[1],caption_extension='.txt')
assert len(files)==3
for f in files:
 with Image.open(f) as im:
  im.convert('RGB').load()
  assert im.height==24
`,path.join(run,'dataset')]);
});
