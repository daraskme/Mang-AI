// Uses the installed model catalog, but never dispatches a GPU generation job.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {MangaService} from '../src/service.js';
import {startEditor} from '../src/editor-server.js';
import {loadConfig} from '../src/config.js';
import {script,tempRoot} from './fixtures.js';

const config=loadConfig();config.dataDir=await tempRoot('kroma-browser');
const service=new MangaService(config,{}),session='kroma-browser';
let project=service.create(session,{title:'モデル選択の確認',brief:'ブラウザ動作確認'});
project=service.setScript(session,{script,revision:project.revision});service.approve(project.id,project.revision);
const editor=await startEditor(service,0);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/nix/store/i068vcjr9d1dk0ahikjpwgsncxbsslsf-google-chrome-153.0.8010.52/share/google/chrome/chrome'});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(editor.generationUrl(project.id,session));
  await page.locator('#refresh').click();
  await page.waitForFunction(()=>[...document.querySelector('#model').options].some(o=>o.value==='kroma-v03-turbo'));
  await page.locator('#quality').selectOption('draft');
  await page.locator('#model').selectOption('kroma-v03-turbo');
  assert.equal(await page.locator('#quality').inputValue(),'balanced');
  assert(await page.locator('#quality option[value="draft"]').isDisabled());
  await page.screenshot({path:'.test-output/kroma-generator.png',fullPage:true});
  await page.goto(editor.url(project.id));
  await page.locator('#refreshModels').click();
  await page.waitForFunction(()=>[...document.querySelector('#generationModel').options].some(o=>o.value==='kroma-v03-turbo'));
  await page.locator('#generationModel').selectOption('kroma-v03-turbo');
  let selected;
  service.render=async(_session,args)=>{selected=args;return {id:'ui-check-only'};};
  await page.locator('#render').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('生成キュー'));
  assert.equal(selected.model_id,'kroma-v03-turbo');assert.equal(selected.preset,'turbo8');
  await page.screenshot({path:'.test-output/kroma-manga-editor.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);console.log('PASS Kroma selection: generator presets, manga model handoff, mobile layout');
} finally {await browser.close();await editor.close();await service.close();}
