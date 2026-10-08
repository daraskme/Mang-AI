import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFile,stat,rm} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {ExternalAccounts} from '../src/external-accounts.js';
import {ExternalAgentJobs} from '../src/external-agent-jobs.js';
import {codexQuota,privateAgentEnv} from '../src/agent-rpc.js';
import {startEditor} from '../src/editor-server.js';
import {MangaService} from '../src/service.js';
import {tempRoot,config} from './fixtures.js';

test('quota distinguishes zero, unknown, multiple windows, and Unix seconds',()=>{
  const q=codexQuota({rateLimitsByLimitId:{codex:{limitId:'codex',primary:{usedPercent:100,resetsAt:1800000000,windowDurationMins:300},secondary:{usedPercent:0,resetsAt:1800600000,windowDurationMins:10080}},other:{limitId:'other',primary:{usedPercent:null,resetsAt:null}}}},123);
  assert.deepEqual(q.windows.map(w=>w.remainingPercent),[0,100,null]);assert.equal(q.windows[0].resetsAt,1800000000);assert.equal(q.updatedAt,123);
  assert.deepEqual(codexQuota({rateLimits:null}).windows,[]);
});
test('account credentials are isolated; selections persist per session without global switching',async()=>{
  const root=await tempRoot('accounts'),a=new ExternalAccounts({directory:root});
  try{const one=a.add({provider:'codex',label:'仕事'}),two=a.add({provider:'devin',label:'個人'});
    const env=privateAgentEnv('codex',a.profile(one.id),{HOME:'/home/test',CODEX_HOME:'/existing',OPENAI_API_KEY:'must-not-leak',DEVIN_MODEL:'other',PATH:'/bin'});
    assert.equal(env.HOME,'/home/test');assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.DEVIN_MODEL,undefined);assert.equal(env.CODEX_HOME,a.profile(one.id));
    assert.notEqual(privateAgentEnv('devin',a.profile(two.id)).XDG_DATA_HOME,a.profile(one.id));
    a.live.set(one.id,{models:[{id:'model-a'}]});a.live.set(two.id,{models:[{id:'model-b'}]});
    a.select('session-a',{accountId:one.id,model:'model-a'});a.select('session-b',{accountId:two.id,model:'model-b'});
    assert.throws(()=>a.select('session-a',{accountId:one.id,model:'missing'}));assert.throws(()=>a.select('__proto__',{accountId:one.id,model:'model-a'}));
    const reopened=new ExternalAccounts({directory:root});assert.equal(reopened.selection('session-a').accountId,one.id);assert.equal(reopened.selection('session-b').accountId,two.id);reopened.close();
    assert.equal((await stat(root)).mode&0o777,0o700);assert.equal((await stat(join(root,'accounts.json'))).mode&0o777,0o600);
  }finally{a.close();await rm(root,{recursive:true,force:true});}
});
test('account API requires its own capability, rejects CSRF and never returns an API key',async()=>{
  const root=await tempRoot('account-api'),service=new MangaService(config(join(root,'studio')),{});let stored;
  const credentials={describe:async()=>({configured:!!stored,writable:true}),set:async(_k,v)=>{stored=v;},unset:async()=>{stored=null;}};
  const a=new ExternalAccounts({directory:join(root,'accounts'),credentials}),editor=await startEditor(service,0,a);
  try{const hash=new URLSearchParams(new URL(editor.accountsUrl()).hash.slice(1)),headers={Authorization:'Bearer '+hash.get('token'),'Content-Type':'application/json'};
    assert.equal((await fetch(editor.origin+'/api/accounts/state')).status,401);
    assert.equal((await fetch(editor.origin+'/api/accounts/deepseek-key',{method:'POST',headers:{...headers,Origin:'https://unrelated.example'},body:'{"key":"synthetic-key-only"}'})).status,403);
    const r=await fetch(editor.origin+'/api/accounts/deepseek-key',{method:'POST',headers,body:'{"key":"synthetic-key-only"}'});assert.equal(r.status,200);assert.equal(stored,'synthetic-key-only');
    const text=await (await fetch(editor.origin+'/api/accounts/state',{headers})).text();assert(!text.includes(stored));assert(JSON.parse(text).deepseek.configured);
    const gallery=new URLSearchParams(new URL(editor.galleryUrl('a'.repeat(32),'test')).hash.slice(1));assert.equal((await fetch(editor.origin+'/api/accounts/state',{headers:{Authorization:'Bearer '+gallery.get('token')}})).status,401);
  }finally{await editor.close();a.close();await service.close();await rm(root,{recursive:true,force:true});}
});
test('running work pins the account/model, approvals are session-owned, and restart never invents completion',async()=>{
  const root=await tempRoot('agent-jobs'),a=new ExternalAccounts({directory:root});
  const one=a.add({provider:'codex',label:'one'}),two=a.add({provider:'codex',label:'two'});for(const account of [one,two])a.live.set(account.id,{authenticated:true,checkedAt:Date.now(),models:[{id:'model'}]});
  a.select('a',{accountId:one.id,model:'model'});const calls=[];let seq=0;
  const rpc=new EventEmitter();rpc.request=async(method,params)=>{calls.push({method,params});if(method==='thread/start')return {thread:{id:'thread-'+(++seq)}};if(method==='turn/start')return {turn:{id:'turn-'+seq}};return {};};rpc.send=m=>calls.push(m);a.connect=async()=>rpc;a.refresh=async id=>a.live.get(id);
  const jobs=new ExternalAgentJobs(a,{sessionDirectory:()=>root});
  try{const first=await jobs.start('a',{prompt:'synthetic task'});await new Promise(r=>setImmediate(r));
    a.select('a',{accountId:two.id,model:'model'});assert.equal(jobs.get('a',first.id).accountId,one.id);assert.throws(()=>jobs.get('b',first.id));
    jobs.request(one.id,{id:42,method:'item/commandExecution/requestApproval',params:{threadId:'thread-1',command:'synthetic command'}},rpc);
    const approval=jobs.get('a',first.id).approval;assert(approval);assert.throws(()=>jobs.respond('b',{jobId:first.id,approvalId:approval.id,allow:true}));
    jobs.respond('a',{jobId:first.id,approvalId:approval.id,allow:false});assert.deepEqual(calls.at(-1).result,{decision:'decline'});
    assert.equal(calls.find(c=>c.method==='thread/start').params.approvalPolicy,'on-request');
    const restarted=new ExternalAgentJobs(a,{sessionDirectory:()=>root});assert.equal(restarted.get('a',first.id).status,'interrupted');
    jobs.notification(one.id,{method:'turn/completed',params:{threadId:'thread-1',turn:{status:'completed'}}});assert.equal(jobs.get('a',first.id).status,'completed');
  }finally{jobs.close();a.close();await rm(root,{recursive:true,force:true});}
});
test('concurrent starts reserve one session and repeated turns share one connection listener',async()=>{
  const root=await tempRoot('agent-concurrency'),a=new ExternalAccounts({directory:root});
  const account=a.add({provider:'codex',label:'test'});a.live.set(account.id,{authenticated:true,models:[{id:'model'}]});a.select('a',{accountId:account.id,model:'model'});
  const rpc=new EventEmitter();rpc.request=async method=>method==='thread/start'?{thread:{id:'thread'}}:method==='turn/start'?{turn:{id:'turn'}}:{};rpc.send=()=>{};
  a.connect=async()=>rpc;a.refresh=async()=>a.live.get(account.id);
  const jobs=new ExternalAgentJobs(a,{sessionDirectory:async()=>root});
  try{
    const started=await Promise.allSettled([jobs.start('a',{prompt:'one'}),jobs.start('a',{prompt:'two'})]);
    assert.equal(started.filter(r=>r.status==='fulfilled').length,1);
    await new Promise(r=>setImmediate(r));
    for(let i=0;i<15;i++){
      jobs.notification(account.id,{method:'turn/completed',params:{threadId:'thread',turn:{status:'completed'}}});
      await jobs.start('a',{prompt:'next'});await new Promise(r=>setImmediate(r));
    }
    assert.equal(rpc.listenerCount('closed'),1);
    const current=jobs.list('a').at(-1);
    jobs.request(account.id,{id:1,method:'item/fileChange/requestApproval',params:{threadId:'thread'}},rpc);assert.equal(jobs.pending.size,1);
    rpc.emit('closed');assert.equal(jobs.get('a',current.id).status,'interrupted');assert.equal(jobs.pending.size,0);assert.equal(jobs.bindings.size,0);
  }finally{jobs.close();a.close();await rm(root,{recursive:true,force:true});}
});
