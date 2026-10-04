import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {MangaService} from '../src/service.js';
import {startEditor} from '../src/editor-server.js';
import {sessionKey} from '../src/store.js';
import {loadConfig} from '../src/config.js';
const c=loadConfig();c.dataDir='.test-output/generator-browser';const service=new MangaService(c,{}),editor=await startEditor(service,0);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/nix/store/i068vcjr9d1dk0ahikjpwgsncxbsslsf-google-chrome-153.0.8010.52/share/google/chrome/chrome'});
try{const page=await browser.newPage({viewport:{width:1300,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(editor.generationUrl(sessionKey('browser'),'browser'));
await page.locator('#provider').selectOption('longvideo');await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#model').options.length>1);
assert((await page.locator('#model').inputValue()).includes('TurboV3'));
await page.locator('#prompt').fill('朝の湖。赤い船。\n\n船が右へ進む。\n\n葦の横を通過する。');await page.locator('#plan').click();await page.waitForFunction(()=>document.querySelector('#result').textContent.includes('estimatedSeconds'));
assert((await page.locator('#result').innerText()).includes('16'));
await page.screenshot({path:'.test-output/generator-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await page.screenshot({path:'.test-output/generator-mobile.png',fullPage:true});assert.deepEqual(errors,[]);console.log('PASS generator GUI: local model discovery, long-video plan, mobile layout');
}finally{await browser.close();await editor.close();await service.close();}
