import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Store, sessionKey } from '../src/store.js';
import { MangaService } from '../src/service.js';
import { normalizeScript, validateBubble, editLettering } from '../src/model.js';
import { pageSVG, bubbleLayout, wrapText } from '../src/render.js';
import { config, tempRoot, script, bubble, png } from './fixtures.js';

test('projects survive restart, isolate DSH sessions, and reject stale edits atomically',async()=>{
  const root=await tempRoot();let s=new Store(root);
  try{
    const a=s.create('session/a',{title:'A',brief:'brief'}),b=s.create('session/b',{title:'B',brief:'brief'});
    assert.notEqual(a.id,b.id);assert(!a.id.includes('/'));
    s.update(a.id,1,p=>{p.pages=normalizeScript(script);});
    assert.throws(()=>s.update(a.id,1,p=>{p.title='lost';}),/別の操作/);
    assert.throws(()=>s.update(a.id,2,p=>{p.title='failed';throw new Error('stop');}),/stop/);
    assert.equal(s.get(a.id).title,'A');assert.equal(s.get(b.id).pages.length,0);
    assert.throws(()=>s.create('session/a',{title:'overwrite',brief:'no'}),/上書き|作品があります/);
    s.close();s=new Store(root);assert.equal(s.get(a.id).pages[0].panels.length,3);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM revisions WHERE id=?').get(a.id).n,2);
    assert.equal(s.history(a.id)[0].revision,2);
    assert.equal(s.restore(a.id,1,2).pages.length,0);
    assert.equal(s.history(a.id)[0].revision,3);
    assert.throws(()=>s.directory('../outside'),/不正/);
  } finally{s.close();await rm(root,{recursive:true,force:true});}
});
test('script and bubble validation preserve roles and reject invalid geometry',()=>{
  assert.equal(normalizeScript(script)[0].panels[1].dialogue[0].speaker,'悠');
  const bad=structuredClone(script);bad.pages[0].panels.pop();assert.throws(()=>normalizeScript(bad),/コマ数/);
  assert.throws(()=>normalizeScript({pages:[script.pages[0],script.pages[0]]}),/隣接/);
  assert.throws(()=>validateBubble({...bubble,x:990}),/ページ外/);
  assert.throws(()=>validateBubble({...bubble,fontSize:Infinity}),/fontSize/);
  assert.throws(()=>validateBubble({...bubble,id:'" onload="x'}),/ID/);
});
test('restart recovers atomic PNG outputs from an interrupted GPU job',async()=>{
  const root=await tempRoot();let service=new MangaService(config(root),{});
  try{
    const p=service.create('crash',{title:'Crash',brief:'brief'});service.setScript('crash',{script,revision:1});
    const approved=service.approve(p.id,2),image='images/p1-c1-1234abcd.png';
    await mkdir(join(root,p.id,'images'));await writeFile(join(root,p.id,image),png);
    service.store.saveJob({id:'job-crash',project:p.id,pageId:'p1',status:'running',digest:approved.approved,panels:['p1-c1','p1-c2','p1-c3'],completed:[],outputs:[{id:'p1-c1',image}]});
    await service.close();service=new MangaService(config(root),{});
    assert.equal(service.status('crash').project.pages[0].panels[0].image,image);
    assert.equal(service.store.getJob('job-crash').status,'interrupted');
    assert.deepEqual(service.store.getJob('job-crash').completed,['p1-c1']);
  }finally{await service.close();await rm(root,{recursive:true,force:true});}
});
test('lettering edits do not change art and exported SVG escapes markup',()=>{
  const p={pages:normalizeScript(script)};p.pages[0].panels[0].image='art.png';
  editLettering(p,{pageId:'p1',action:'upsert',bubble:{...bubble,text:'「<script>」&'} });
  assert.equal(p.pages[0].panels[0].image,'art.png');
  const svg=pageSVG(p.pages[0]);assert(!svg.includes('<script>'));assert(svg.includes('&lt;script&gt;'));assert(svg.includes('vertical-rl'));
  editLettering(p,{pageId:'p1',action:'delete',id:bubble.id});assert.equal(p.pages[0].bubbles.length,0);
});
test('Japanese line breaks, grapheme clusters, and overflow are explicit',()=>{
  assert.deepEqual(wrapText('こんにちは\nまた明日',20),['こんにちは','また明日']);
  assert.deepEqual(wrapText('あいう、え',3),['あいう、','え']);
  assert.deepEqual(wrapText('👩‍💻あ',1),['👩‍💻','あ']);
  assert.equal(bubbleLayout(bubble).overflow,false);
  assert.equal(bubbleLayout({...bubble,text:'長い台詞'.repeat(80)}).overflow,true);
});
test('Gemma cannot overwrite concurrent manual edits; script changes retain lettering',async()=>{
  const root=await tempRoot();let finish;
  const s=new MangaService(config(root),{}, {creative:()=>new Promise(resolve=>{finish=resolve;})});
  try{
    const p=s.create('s',{title:'Title',brief:'brief'});
    const work=s.draft('s',{instruction:'draft',pageCount:1,revision:1},new AbortController().signal);
    s.setScript('s',{script,revision:1});
    finish({pages:normalizeScript(script),request:{},response:'response'});
    await assert.rejects(work,/別の操作/);
    s.letter('s',{pageId:'p1',revision:2,action:'upsert',bubble});
    const next=s.setScript('s',{script,revision:3});assert.equal(next.pages[0].bubbles[0].text,bubble.text);
    assert.equal(next.pages[0].letteringNeedsReview,true);assert.equal(next.approved,null);
    s.approve(p.id,4);const exported=await s.export('s');
    assert.match(await readFile(exported.pages[0],'utf8'),/これ、あなたに。/);
    assert.equal(exported.warnings.length,3);
  }finally{await s.close();await rm(root,{recursive:true,force:true});}
});
