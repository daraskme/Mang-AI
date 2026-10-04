// Explicit real-model + browser validation, not part of the unit test command.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { writeFile,readFile,readdir,copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { MangaService } from '../src/service.js';
import { startEditor } from '../src/editor-server.js';
import { config,tempRoot,script } from './fixtures.js';
import { nativeSubprocess } from './native-subprocess.mjs';

const root=await tempRoot('live-edit'),c=config(root),service=new MangaService(c,nativeSubprocess),editor=await startEditor(service,0);
let executablePath=process.env.CHROME_PATH;
if(!executablePath){const entries=await readdir('/nix/store');const name=entries.find(s=>s.includes('-google-chrome-')&&!s.endsWith('.drv'));if(name)executablePath=join('/nix/store',name,'share/google/chrome/chrome');}
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']}),page=await browser.newPage({viewport:{width:1440,height:1080}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
  const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');let seed=4;for(let j=0;j<256;j++)for(let i=0;i<256;i++){seed=(seed*1664525+1013904223)>>>0;x.fillStyle=`rgb(${seed%255},${(seed>>>8)%255},${(seed>>>16)%255})`;x.fillRect(i,j,1,1);}return c.toDataURL('image/png').split(',')[1];});
  const source=join(root,'fixture.png');await writeFile(source,Buffer.from(data,'base64'));
  let p=service.create('editor-test',{title:'修正テスト',brief:'IOPaint とモザイク'});p=service.setScript('editor-test',{script,revision:p.revision});
  const image=`images/p1-c1-${randomUUID()}.png`;await import('node:fs/promises').then(fs=>fs.mkdir(join(service.store.directory(p.id),'images'),{recursive:true}));await copyFile(source,join(service.store.directory(p.id),image));
  p=service.store.update(p.id,p.revision,p=>p.pages[0].panels[0].image=image);
  const asset=await service.edits.open('editor-test',{pageId:'p1',panelId:'p1-c1'},AbortSignal.timeout(60000));
  await page.goto(editor.mediaUrl(p.id,asset.id));await page.waitForFunction(()=>document.querySelector('#dimensions').textContent.includes('256 × 256'));
  await page.click('#detect');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('箇所を検出')||document.querySelector('#status').style.color==='rgb(170, 73, 58)',{},{timeout:180000});
  assert.match(await page.locator('#status').textContent(),/箇所を検出/);await page.click('#clear');console.log('PASS AnimeCensor real model on non-sensitive fixture');
  await page.selectOption('#tool','rectangle');await page.fill('#block','16');
  async function rectangle(){const box=await page.locator('#mask').boundingBox();await page.mouse.move(box.x+box.width*.25,box.y+box.height*.25);await page.mouse.down();await page.mouse.move(box.x+box.width*.75,box.y+box.height*.75);await page.mouse.up();}
  await rectangle();await page.click('#mosaic');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('処理が完了'),{},{timeout:120000});
  assert.equal(service.edits.get(p.id,asset.id).versions.length,2);console.log('PASS manual browser mosaic');
  await page.uncheck('input[value=penis]');await page.uncheck('input[value=vagina]');await page.check('input[value=mosaic]');await page.click('#detect');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('箇所を検出'),{},{timeout:120000});
  assert.match(await page.locator('#status').textContent(),/^[1-9]/);console.log('PASS upstream mosaic auto-detection');
  await page.click('#inpaint');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('処理が完了')||document.querySelector('#status').style.color==='rgb(170, 73, 58)',{},{timeout:300000});
  assert.match(await page.locator('#status').textContent(),/処理が完了/);console.log('PASS IOPaint LaMa real inference');
  await page.click('#commit');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('コマへ反映'));
  assert.notEqual(service.status('editor-test').project.pages[0].panels[0].image,image);
  assert.deepEqual(await readFile(join(service.store.directory(p.id),image)),await readFile(source));
  await page.screenshot({path:join(root,'editor.png'),fullPage:true});
  await page.selectOption('#versions','original');await page.click('#restore');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('選択した版'));
  assert.equal(service.edits.get(p.id,asset.id).current,'original');
  await page.setViewportSize({width:430,height:932});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.screenshot({path:join(root,'editor-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  // Exercise video Range serving and preserve the source's audio through mosaic.
  const video=join(root,'input.mp4');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=128x128:rate=24','-f','lavfi','-i','sine=frequency=440','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',video]);
  const v=await service.edits.open('editor-test',{path:video},AbortSignal.timeout(60000));
  const job=service.edits.enqueue(p.id,{assetId:v.id,revision:v.revision,mode:'mosaic',regions:[{x:32,y:32,width:64,height:64}],block:16});await service.edits.tail;
  const finished=service.edits.get(p.id,job.id,'edit-job');assert.equal(finished.status,'completed',finished.error);
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',finished.outputPath]));assert(probe.streams.some(s=>s.codec_type==='audio'));
  await page.setViewportSize({width:1440,height:1080});await page.goto(editor.mediaUrl(p.id,v.id));await page.waitForFunction(()=>document.querySelector('#dimensions').textContent.includes('128 × 128'));await page.waitForFunction(()=>document.querySelector('#video').readyState>=2);
  await page.locator('#timeline').fill('0.5');await page.locator('#timeline').dispatchEvent('input');await page.waitForFunction(()=>document.querySelector('#video').currentTime>.4);await page.screenshot({path:join(root,'video-editor.png'),fullPage:true});
  console.log('PASS video mosaic, audio preservation, browser seeking, history, comic commit, mobile layout');
}finally{await browser.close();await editor.close();await service.close();console.log('Artifacts: '+root);}
