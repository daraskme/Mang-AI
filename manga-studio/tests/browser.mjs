import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { readdir, access, readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MangaService } from '../src/service.js';
import { startEditor } from '../src/editor-server.js';
import { packageRoot } from '../src/config.js';
import { config, tempRoot, script, bubble } from './fixtures.js';

const root=await tempRoot('browser'),service=new MangaService(config(root),{});
const project=service.create('browser-fixture',{title:'雨上がりの手紙',brief:'吹き出し編集の動作確認用ページ。画像はまだ生成していません。',characters:'紗季：紺色のコート。悠：薄茶色のジャケット。'});
service.setScript('browser-fixture',{script,revision:1});
service.letter('browser-fixture',{pageId:'p1',revision:2,action:'upsert',bubble});
const editor=await startEditor(service,0);let browser;
try{
  let executablePath=process.env.CHROME_PATH;
  if(!executablePath){try{const names=await readdir('/nix/store');for(const name of names.filter(x=>/-google-chrome-[\d.]+$/.test(x))){const file=join('/nix/store',name,'share/google/chrome/chrome');try{await access(file);executablePath=file;break;}catch{ /* Try the next installed Chrome. */ }}}catch{/* Use Playwright's installed browser. */}}
  browser=await chromium.launch({headless:true,...executablePath?{executablePath}:{}});
  const page=await browser.newPage({viewport:{width:1440,height:1080},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(editor.url(project.id));await page.locator('#title').filter({hasText:'雨上がりの手紙'}).waitFor();
  await page.locator('#selection').selectOption('b-test');
  await page.locator('#text').fill('「待って」\nまだ、伝えていない。');
  await page.locator('#direction').selectOption('horizontal');
  await page.locator('#width').fill('280');await page.locator('#x').fill('660');
  await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('保存しました'));
  await page.reload();await page.locator('#selection').selectOption('b-test');assert.equal(await page.locator('#text').inputValue(),'「待って」\nまだ、伝えていない。');
  const rect=await page.locator('[data-hit="b-test"]').boundingBox();
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2-30,rect.y+rect.height/2+35,{steps:5});await page.mouse.up();
  await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('保存しました'));
  assert(service.status('browser-fixture').project.pages[0].bubbles[0].x<660);
  await page.locator('.dialogue button').nth(1).click();await page.waitForFunction(()=>document.querySelector('#status').textContent==='吹き出しを追加しました');
  assert.equal(service.status('browser-fixture').project.pages[0].bubbles.length,2);
  await page.locator('#approve').click();await page.waitForFunction(()=>document.querySelector('#approve').disabled);
  const out=join(packageRoot,'.test-output');await mkdir(out,{recursive:true});
  for(const [id,name] of [['downloadSvg','page.svg'],['downloadPng','page.png']]){
    const event=page.waitForEvent('download');await page.locator('#'+id).click();const download=await event;await download.saveAs(join(out,name));
  }
  const svg=await readFile(join(out,'page.svg'),'utf8');assert(svg.includes('今、読んでもいい？'));assert(svg.includes('vertical-rl'));
  const png=await readFile(join(out,'page.png'));assert.equal(png.readUInt32BE(16),2000);assert.equal(png.readUInt32BE(20),2828);
  await page.evaluate(()=>{document.querySelector('.inspector').scrollTop=0;document.querySelector('.canvas-area').scrollTop=0;});
  await page.screenshot({path:join(out,'editor-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'editor-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  console.log('PASS browser: Japanese lettering, drag, save/reload, script approval, SVG/PNG download, mobile layout');
  console.log(`Screenshots: ${out}/editor-desktop.png and editor-mobile.png`);
}finally{if(browser)await browser.close();await editor.close();await service.close();await rm(root,{recursive:true,force:true});}
