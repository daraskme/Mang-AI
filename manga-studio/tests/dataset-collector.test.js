import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatasetCollector,collectionPlan,registerDatasetTools} from '../src/dataset-collector.js';

test('collector validates URL boundaries and plan never starts a process',async()=>{
  const valid={dataset:'sample',urls:['https://x.com/example/status/1'],limit:2};
  assert.equal(collectionPlan(valid).limit,2);
  for(const urls of [['http://x.com/a'],['https://x.com.evil.test/a'],['https://x.com/a?api_key=private'],['https://127.0.0.1/'],['https://user:secret@pixiv.net/a']])assert.throws(()=>collectionPlan({...valid,urls}));
  assert.throws(()=>collectionPlan({...valid,dataset:'../escape'}));
  const registry=new Map();registerDatasetTools((name,_d,_p,fn)=>registry.set(name,fn),{start(){throw Error('plan spawned');}});
  assert.equal(registry.get('dataset_collect')(valid,{agent:{id:'one'}}).networkAccess,false);
});
test('collection status and cancellation are session owned; duplicate process exits are safe',async()=>{
  const root=await mkdtemp(join(tmpdir(),'collector-')),child=new EventEmitter();child.kill=signal=>{child.signal=signal;};
  const collector=new DatasetCollector({root,spawnProcess:()=>child});
  try{
    const job=await collector.start('one',{dataset:'test',urls:['https://pixiv.net/artworks/1']});
    await assert.rejects(collector.job('two',job.id),/別セッション/);
    await assert.rejects(collector.start('one',{dataset:'test',urls:['https://pixiv.net/artworks/1']}),/実行中/);
    await collector.job('one',job.id,'cancel');assert.equal(child.signal,'SIGTERM');
    child.emit('error',Error('spawn failed'));child.emit('close',1);
    for(let i=0;i<50;i++){if((await collector.job('one',job.id)).state==='failed')break;await new Promise(r=>setTimeout(r,10));}
    assert.equal((await collector.job('one',job.id)).state,'failed');
  }finally{collector.close();await rm(root,{recursive:true,force:true});}
});
