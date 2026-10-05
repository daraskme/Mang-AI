import test from 'node:test';
import assert from 'node:assert/strict';
import {rm} from 'node:fs/promises';
import {MangaService} from '../src/service.js';
import {validatePlan,planningContext,visualContinuity} from '../src/manga-planning.js';
import {config,tempRoot} from './fixtures.js';

const settings={summary:'家で会話してから玄関で見送る',characters:[{id:'a',name:'人物A',appearance:'青い上着と白い鞄',voice:'短く話す'}],locations:[{id:'living',name:'リビング',description:'窓と青いソファ',connectsTo:['entry']},{id:'entry',name:'玄関',description:'北の扉と靴箱',connectsTo:['living']}],scenes:[{id:'s1',locationId:'living',characterIds:['a'],before:'座る',action:'立つ',after:'玄関へ向かう'},{id:'s2',locationId:'entry',characterIds:['a'],before:'室内',action:'扉を開く',after:'外に出る'}]};
const pages={rationale:'会話と出発にそれぞれ1コマ',pages:[{id:'p1',layout:'縦2（上大）',purpose:'出発',before:'会話中',after:'外に出る',panels:[{sceneId:'s1',action:'立ち上がる',composition:'正面、上に余白'},{sceneId:'s2',action:'扉を開く',composition:'室内側から、右に余白'}]}]};
const prompts={pageId:'p1',layout:'縦2（上大）',purpose:'出発',pageBrief:'Departure from the same house.',panels:[{sceneId:'s1',locationId:'living',characterIds:['a'],continuity:'青い上着と白い鞄',action:'立ち上がる',artPrompt:'A person in a blue jacket stands by a blue sofa, holding a white bag.',dialogue:[]},{sceneId:'s2',locationId:'entry',characterIds:['a'],continuity:'同じ青い上着と白い鞄',action:'扉を開く',artPrompt:'The same person in a blue jacket opens the north entrance door, holding the white bag.',dialogue:[]}]};

test('stages persist and reject missing background references, skipped stages and stale downstream art',async()=>{
  const root=await tempRoot();let result=settings;
  const s=new MangaService(config(root),{}, {planner:async()=>({value:structuredClone(result),response:'mock',request:{}})});
  try{
    let p=s.create('plan',{title:'家',brief:'出発'});const signal=new AbortController().signal;
    await assert.rejects(s.plan('plan',{stage:'pages',revision:p.revision,instruction:'配分'},signal),/先に設定/);
    const bad=structuredClone(settings);bad.scenes[1].locationId='missing';assert.throws(()=>validatePlan('settings',bad,p),/未登録ID/);
    p=(await s.plan('plan',{stage:'settings',revision:p.revision,instruction:'設定'},signal)).project;
    result=pages;p=(await s.plan('plan',{stage:'pages',revision:p.revision,instruction:'配分'},signal)).project;
    result=structuredClone(prompts);result.panels[1].locationId='living';
    await assert.rejects(s.plan('plan',{stage:'prompts',pageId:'p1',revision:p.revision,instruction:'作画指示'},signal),/場所/);
    result=prompts;p=(await s.plan('plan',{stage:'prompts',pageId:'p1',revision:p.revision,instruction:'作画指示'},signal)).project;
    assert.equal(p.pages[0].panels[1].id,'p1-c2');assert.equal(p.production.prompts.p1.pageBrief,prompts.pageBrief);
    assert.equal(planningContext(p,'prompts','p1').locations.length,2);
    const second=visualContinuity(p,p.pages[0],p.pages[0].panels[1]);
    assert(second.includes('青い上着と白い鞄'));assert(second.includes('北の扉と靴箱'));assert(!second.includes('窓と青いソファ'));
    const saved=p.revision;result=settings;p=(await s.plan('plan',{stage:'settings',revision:p.revision,instruction:'設定更新'},signal)).project;
    assert.equal(p.production.pages,null);assert.deepEqual(p.production.prompts,{});
    await assert.rejects(s.render('plan',{pageId:'p1'}),/更新してください/);
    p=s.store.restore(p.id,saved,p.revision);assert(p.production.prompts.p1);assert.equal(p.approved,null);
  }finally{await s.close();await rm(root,{recursive:true,force:true});}
});

test('Gemma planning cannot overwrite edits made while it is running',async()=>{
  const root=await tempRoot();let finish;
  const s=new MangaService(config(root),{}, {planner:()=>new Promise(resolve=>{finish=resolve;})});
  try{
    const p=s.create('plan',{title:'家',brief:'出発'});
    const work=s.plan('plan',{stage:'settings',revision:p.revision,instruction:'設定'},new AbortController().signal);
    s.store.update(p.id,p.revision,state=>{state.brief='利用者の追記';});
    finish({value:settings,response:'mock',request:{}});
    await assert.rejects(work,/別の操作/);assert.equal(s.store.get(p.id).brief,'利用者の追記');assert.equal(s.store.get(p.id).production,undefined);
  }finally{await s.close();await rm(root,{recursive:true,force:true});}
});

test('all stages resume from the saved boundary and enforce the total page count',async()=>{
  const root=await tempRoot(),calls=[];let fail=true;
  const s=new MangaService(config(root),{}, {planner:async(_p,_c,{stage})=>{calls.push(stage);if(stage==='prompts'&&fail)throw Error('interrupted');return {value:structuredClone({settings,pages,prompts}[stage]),response:'mock',request:{}};}});
  try{
    s.create('all',{title:'家',brief:'出発'});const signal=new AbortController().signal;
    await assert.rejects(s.plan('all',{stage:'all',pageCount:1,revision:1,instruction:'1ページ2コマ'},signal),/interrupted/);
    assert.equal(s.status('all').project.revision,3);fail=false;
    const result=await s.plan('all',{stage:'all',pageCount:1,revision:3,instruction:'1ページ2コマ'},signal);
    assert.deepEqual(calls,['settings','pages','prompts','prompts']);assert(result.project.production.prompts.p1);
    await assert.rejects(s.plan('all',{stage:'all',pageCount:2,revision:4,instruction:'2ページ'},signal),/ページ数/);
  }finally{await s.close();await rm(root,{recursive:true,force:true});}
});
