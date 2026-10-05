// Deterministic live state transitions in the real GUI, without model loading.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {MangaService} from '../src/service.js';
import {startEditor} from '../src/editor-server.js';
import {config,tempRoot,script,bubble} from './fixtures.js';

const c=config(await tempRoot('progress-browser')),s=new MangaService(c,{});let p=s.create('progress-browser',{title:'制作進捗の表示テスト',brief:'進捗と編集中の台詞'});
p=s.setScript('progress-browser',{script,revision:1});p=s.letter('progress-browser',{pageId:'p1',revision:2,action:'upsert',bubble}).project;
const editor=await startEditor(s,0),browser=await chromium.launch({headless:true,args:['--disable-gpu'],executablePath:process.env.CHROME_PATH||'/nix/store/i068vcjr9d1dk0ahikjpwgsncxbsslsf-google-chrome-153.0.8010.52/share/google/chrome/chrome'});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(editor.url(p.id));await page.locator('#selection').selectOption(bubble.id);await page.locator('#text').fill('保存前の台詞');
  const job={id:'browser-job',project:p.id,pageId:'p1',status:'running',panels:['p1-c1','p1-c2','p1-c3'],completed:['p1-c1'],createdAt:new Date().toISOString(),progress:{panelId:'p1-c2',message:'サンプリング中',ratio:.5}};s.store.saveJob(job);
  await page.waitForFunction(()=>document.querySelector('#productionProgress').textContent.includes('1/3コマ生成済み'));
  assert.match(await page.locator('#productionProgress').textContent(),/サンプリング中 · 50%/);assert.equal(await page.locator('#text').inputValue(),'保存前の台詞');
  await page.screenshot({path:c.dataDir+'/running-editor.png',fullPage:true});
  job.status='failed';job.error='テスト用の生成エラー';s.store.saveJob(job);
  await page.waitForFunction(()=>document.querySelector('#productionProgress [data-stage="render"]').dataset.state==='failed');
  assert.equal(await page.locator('#text').inputValue(),'保存前の台詞');
  page.on('dialog',dialog=>dialog.accept());await page.goto(editor.progressUrl(p.id,'progress-browser'));
  await page.waitForFunction(()=>document.querySelector('.progress-card')?.textContent.includes('テスト用の生成エラー'));
  job.status='completed';job.completed=[...job.panels];job.error=null;s.store.saveJob(job);
  s.store.update(p.id,p.revision,state=>state.pages[0].panels.forEach(panel=>panel.image='fixture.png'));
  await page.waitForFunction(()=>document.querySelector('[data-stage="render"]').dataset.state==='completed');
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:c.dataDir+'/progress-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
  console.log('PASS progress GUI: automatic running/failure/completion, unsaved dialogue preserved, session overview, mobile layout');
}finally{await browser.close();await editor.close();await s.close();}
