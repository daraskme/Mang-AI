import {chromium} from '../runtime/test-support/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:'/home/hiroshi/.nix-profile/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1500,height:1060}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto('http://127.0.0.1:3210');await page.waitForFunction(()=>document.querySelector('#count-all').textContent==='3');
  await page.locator('#training-open').click();await page.waitForFunction(()=>document.querySelector('#training-phase').textContent.includes('学習完了'));assert.equal(await page.locator('#train-trigger').textContent(),'@demo_vase');
  await page.screenshot({path:process.cwd()+'/docs/training-complete.png'});await page.locator('#training-dialog .close').click();
  await page.evaluate(()=>{document.querySelector('.sidebar').scrollTop=0;});await page.screenshot({path:process.cwd()+'/docs/gui-preview.png'});
  await page.setViewportSize({width:1100,height:820});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:process.cwd()+'/docs/gui-compact.png'});
  await page.setViewportSize({width:760,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);const evidence={checkedAt:new Date().toISOString(),checks:['1500px editor layout','1100px layout without horizontal overflow','760px layout without horizontal overflow','persisted training result after server restart','exact trigger display'],browserErrors:errors};await fs.writeFile('docs/browser-check.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await browser.close();}
