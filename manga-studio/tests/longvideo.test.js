import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalStudios} from '../src/local-studios.js';
import {Store} from '../src/store.js';
import {planLongVideo} from '../src/longvideo.js';
import {config,tempRoot} from './fixtures.js';

test('long-video plan bounds total duration and keeps shot text verbatim',()=>{
  const prompt='場面設定。\n\n左へ歩く。\n\n窓を開く。';
  const p=planLongVideo({prompt,shot_seconds:8});assert.equal(p.estimatedSeconds,16);assert.equal(p.shots[1].prompt,'窓を開く。');
  assert.throws(()=>planLongVideo({prompt:'段落なし'}),/共通/);
  assert.throws(()=>planLongVideo({prompt:'場面\n\n'+Array(10).fill('動く').join('\n\n'),shot_seconds:15}),/120/);
});
test('long-video cancellation is session-owned and targets only its prompt; completion survives adapter restart',async t=>{
  const root=await tempRoot('longvideo'),store=new Store(root),c=config(root);c.longvideo={baseURL:'http://127.0.0.1:8190'};
  t.after(()=>store.close());const s=new LocalStudios(c,store,{}),calls=[];
  const id=s.save('alice','media',{provider:'longvideo',remoteId:'owned-prompt',request:{}});
  s.request=async(p,path,args)=>{calls.push({path,args});return {};};
  await assert.rejects(s.job('bob',id,'cancel'),/このセッション/);assert.equal(calls.length,0);
  await s.job('alice',id,'cancel');assert.deepEqual(calls.map(c=>c.args.body),[{delete:['owned-prompt']},{prompt_id:'owned-prompt'}]);
  const r=new LocalStudios(c,store,{});r.request=async()=>({'owned-prompt':{status:{status_str:'success'},outputs:{}}});
  assert.equal((await r.job('alice',id)).job.status,'failed');
});
