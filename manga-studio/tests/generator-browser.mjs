import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {rm} from 'node:fs/promises';
import {MangaService} from '../src/service.js';
import {startEditor} from '../src/editor-server.js';
import {sessionKey} from '../src/store.js';
import {config,tempRoot} from './fixtures.js';

// Exercise the real GUI/API and planning code without starting GPU services.
const root=await tempRoot('generator-browser'),c=config(join(root,'data'));
const service=new MangaService(c,{}),editor=await startEditor(service,0);
service.studios.status=async provider=>{assert.equal(provider,'longvideo');return {models:['test-base.safetensors','test-TurboV3.safetensors'],loras:[],options:{optional:{latent_upscale:[['off','test-upscaler']]}}};};
service.studios.save('browser','media',{provider:'krea',remoteId:'legacy-record'});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/nix/store/i068vcjr9d1dk0ahikjpwgsncxbsslsf-google-chrome-153.0.8010.52/share/google/chrome/chrome'});
try{
 const page=await browser.newPage({viewport:{width:1300,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(editor.generationUrl(sessionKey('browser'),'browser'));
 await expect(page.locator('#history button')).toContainText('生成結果');
 await expect(page.locator('#status')).toHaveText('更新しました');
 await page.locator('#provider').selectOption('longvideo');await page.locator('#refresh').click();await expect(page.locator('#model option')).toHaveCount(2);
 assert((await page.locator('#model').inputValue()).includes('TurboV3'));
 await page.locator('#prompt').fill('朝の湖。赤い船。\n\n船が右へ進む。\n\n葦の横を通過する。');await page.locator('#plan').click();await expect(page.locator('#result')).toContainText('estimatedSeconds');
 assert((await page.locator('#result').innerText()).includes('16'));
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);console.log('PASS generator GUI: model selection, legacy history, real long-video plan and mobile layout (no GPU services)');
}finally{await browser.close();await editor.close();await service.close();await rm(root,{recursive:true,force:true});}
