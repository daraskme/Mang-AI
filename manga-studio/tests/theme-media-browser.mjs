// Theme changes must never recolor artwork or reset an unsaved mask.
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {MangaService} from '../src/service.js';
import {startEditor} from '../src/editor-server.js';
import {sessionKey} from '../src/store.js';
import {config,tempRoot,png} from './fixtures.js';
const root=await tempRoot('theme-media'),service=new MangaService(config(root),{}),source=join(root,'fixture.png');
await writeFile(source,png);service.edits.worker=async()=>({kind:'image',width:1,height:1});
const asset=await service.edits.open('theme-fixture',{path:source}),editor=await startEditor(service,0);
const browser=await chromium.launch({headless:true,args:['--disable-gpu'],executablePath:process.env.CHROME_PATH||'/nix/store/i068vcjr9d1dk0ahikjpwgsncxbsslsf-google-chrome-153.0.8010.52/share/google/chrome/chrome'});
try{
  const context=await browser.newContext({viewport:{width:1200,height:950}}),host=await context.newPage(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await host.goto(editor.origin+'/embedded.css');
  await page.goto(editor.mediaUrl(sessionKey('theme-fixture'),asset.id));await expect(page.locator('#dimensions')).toContainText('1 × 1');
  const image=await page.locator('#picture').evaluate(canvas=>canvas.toDataURL());
  await page.locator('#tool').selectOption('rectangle');const box=await page.locator('#mask').boundingBox();
  await page.mouse.move(box.x+box.width*.1,box.y+box.height*.1);await page.mouse.down();await page.mouse.move(box.x+box.width*.9,box.y+box.height*.9,{steps:4});await page.mouse.up();
  assert(await page.evaluate(()=>window.mangAIHasUnsavedChanges()));const mask=await page.locator('#mask').evaluate(canvas=>canvas.toDataURL());
  for(const theme of ['dark','light']){
    await host.evaluate(theme=>localStorage.setItem('mang-ai-theme-snapshot',JSON.stringify({theme,tokens:{}})),theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    await expect(page.locator('.media-inspector')).toHaveCSS('background-color',theme==='dark'?'rgb(27, 27, 28)':'rgb(249, 250, 251)');
    await expect(page.locator('#inpaint')).toHaveCSS('color',theme==='dark'?'rgb(21, 21, 23)':'rgb(255, 255, 255)');
    assert.equal(await page.locator('#picture').evaluate(canvas=>canvas.toDataURL()),image);assert.equal(await page.locator('#mask').evaluate(canvas=>canvas.toDataURL()),mask);assert(await page.evaluate(()=>window.mangAIHasUnsavedChanges()));
    await page.screenshot({path:join(root,'media-'+theme+'.png')});
  }
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(root,'media-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS retouch themes: light/dark controls, original image and unsaved mask unchanged, standalone sync, mobile');
}finally{await browser.close();await editor.close();await service.close();}
