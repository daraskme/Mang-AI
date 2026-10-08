import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { MangaService } from '../src/service.js';
import { writeScript } from '../src/creative.js';
import { sessionKey } from '../src/store.js';
import { config, tempRoot, script, bubble, png } from './fixtures.js';

test('Gemma uses local chat completions and rejects truncated or malformed output',async()=>{
  let request,mode='ok';const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;request=JSON.parse(body);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:mode==='length'?'length':'stop',message:{content:mode==='invalid'?'not json':JSON.stringify(script)}}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const c=config('.').gemma;c.baseURL=`http://127.0.0.1:${server.address().port}`;
    const p={title:'Title',brief:'brief',characters:'紗季と悠',style:'ink',pages:[]};
    const result=await writeScript(p,c,'write',1,new AbortController().signal);
    assert.equal(result.pages.length,1);assert.equal(request.model,c.model);assert.equal(request.stream,false);
    assert.match(request.messages[0].content,/人物と動詞を分ける/);assert.match(request.messages[1].content,/紗季と悠/);
    mode='length';await assert.rejects(writeScript(p,c,'write',1,new AbortController().signal),/途切れ/);
    mode='invalid';await assert.rejects(writeScript(p,c,'write',1,new AbortController().signal),/保存できません/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
async function setup(root,spawn){
  const c=config(root);c.krea.repo=root;c.krea.python=join(root,'python');c.krea.weights=join(root,'weights');
  for(const file of ['python','inference.py','weights'])await writeFile(join(root,file),'fixture');
  const s=new MangaService(c,{spawn});s.create('s',{title:'Title',brief:'brief'});s.setScript('s',{script,revision:1});return s;
}
test('official Python argv is shell-free; GPU jobs serialize, and successful art survives restart',async()=>{
  const root=await tempRoot();let active=0,maxActive=0,count=0;
  let s=await setup(root,spec=>{
    active++;maxActive=Math.max(active,maxActive);count++;
    assert.equal(spec.argv.length,2);assert(spec.argv[1].endsWith('render_krea.py'));assert.equal(spec.cwd,root);assert.equal(spec.env.OSS_TURBO,join(root,'weights'));
    const req=JSON.parse(spec.stdio.stdin.data);assert(req.panels.every(p=>/no lettering/i.test(p.prompt) && p.width%16===0));
    const done=(async()=>{for(const p of req.panels)await writeFile(p.output,png);active--;return {exitCode:0,signal:null};})();
    return {done,waitForExit:async()=>{},collected:{}};
  });
  try{
    await assert.rejects(s.render('s',{pageId:'p1'}),/脚本/);
    s.approve(sessionKey('s'),2);
    const job=await s.render('s',{pageId:'p1',seed:123});await s.queue;
    assert.equal(job.balloonMode,'generated');assert.equal(s.status('s').project.pages[0].panels[0].balloonMode,'generated');
    assert.equal(s.store.getJob(job.id).status,'completed');assert.equal(s.status('s').project.pages[0].panels.filter(p=>p.image).length,3);
    await assert.rejects(s.render('s',{pageId:'p1'}),/全コマ/);
    const before=s.status('s').project.pages[0].panels[0].image;
    const rev=s.status('s').project.revision;s.letter('s',{pageId:'p1',action:'upsert',bubble,revision:rev});
    assert.equal(s.status('s').project.pages[0].panels[0].image,before);
    s.create('other',{title:'B',brief:'brief'});s.setScript('other',{script,revision:1});s.approve(sessionKey('other'),2);
    await Promise.all([s.render('s',{pageId:'p1',regenerate:true}),s.render('other',{pageId:'p1'})]);await s.queue;
    assert.equal(maxActive,1);assert.equal(count,3);
    await s.close();s=new MangaService(config(root),{});assert.equal(s.status('s').project.pages[0].bubbles[0].text,bubble.text);
  }finally{await s.close();await rm(root,{recursive:true,force:true});}
});
test('cancel keeps completed PNGs and retry only asks for missing panels',async()=>{
  const root=await tempRoot();let invocation=0;
  const s=await setup(root,spec=>{
    invocation++;const req=JSON.parse(spec.stdio.stdin.data);
    const done=(async()=>{
      if(invocation===1){await writeFile(req.panels[0].output,png);if(!spec.signal.aborted)await new Promise(resolve=>spec.signal.addEventListener('abort',resolve,{once:true}));return {exitCode:null,signal:'SIGTERM'};}
      assert.equal(req.panels.length,2);for(const p of req.panels)await writeFile(p.output,png);return {exitCode:0,signal:null};
    })();return {done,waitForExit:async()=>{},collected:{}};
  });
  try{
    s.approve(sessionKey('s'),2);const job=await s.render('s',{pageId:'p1'});
    while(invocation===0)await new Promise(resolve=>setTimeout(resolve,5));
    assert.throws(()=>s.cancel('other',job.id),/別セッション/);
    s.cancel('s',job.id);await s.queue;
    assert.equal(s.store.getJob(job.id).status,'canceled');assert.equal(s.store.getJob(job.id).completed.length,1);
    const retry=await s.render('s',{pageId:'p1'});await s.queue;assert.equal(s.store.getJob(retry.id).status,'completed');
  }finally{await s.close();await rm(root,{recursive:true,force:true});}
});
test('edited scripts never receive stale generated art',async()=>{
  const root=await tempRoot();let release,started;
  const ready=new Promise(resolve=>{started=resolve;});
  const s=await setup(root,spec=>{
    const req=JSON.parse(spec.stdio.stdin.data),done=(async()=>{started();await new Promise(resolve=>{release=resolve;});for(const p of req.panels)await writeFile(p.output,png);return {exitCode:0,signal:null};})();return {done,waitForExit:async()=>{},collected:{}};
  });
  try{
    s.approve(sessionKey('s'),2);const job=await s.render('s',{pageId:'p1'});await ready;
    const changed=structuredClone(script);changed.pages[0].panels[0].artPrompt='A different view';s.setScript('s',{script:changed,revision:3});release();await s.queue;
    assert.equal(s.store.getJob(job.id).status,'superseded');assert.equal(s.status('s').project.pages[0].panels[0].image,null);
  }finally{await s.close();await rm(root,{recursive:true,force:true});}
});
