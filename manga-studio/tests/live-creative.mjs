// Explicit opt-in: loads the local creative model and writes one test page.
import assert from 'node:assert/strict';
import {MangaService} from '../src/service.js';
import {loadConfig} from '../src/config.js';
import {nativeSubprocess} from './native-subprocess.mjs';
const c=loadConfig();c.dataDir='.test-output/creative-live';c.gemma.maxTokens=4096;
const s=new MangaService(c,nativeSubprocess),session='creative-test-'+Date.now();
try{
  s.create(session,{title:'忘れ物の傘',brief:'雨がやんだ喫茶店。店主が帰りかけた客に忘れ物の傘を渡す。ほっとする短い一場面。',characters:'店主は落ち着いた口調。客は急いでいるが礼を忘れない。'});
  const r=await s.draft(session,{instruction:'1ページ、2コマか3コマ。台詞は短く、誰の傘かを分かるように。',pageCount:1,revision:1},AbortSignal.timeout(600000));
  assert.equal(r.project.pages.length,1);assert(r.project.pages[0].panels.every(p=>typeof p.artPrompt==='string'&&p.artPrompt.length>0));
  console.log(JSON.stringify({result:'PASS actual Ortenzya draft',pages:r.project.pages.length,panels:r.project.pages[0].panels.length,trace:r.trace}));
}finally{await s.close();}
