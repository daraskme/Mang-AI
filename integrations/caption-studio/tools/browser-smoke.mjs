import {chromium} from '../runtime/test-support/playwright-core/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('.');
const browser=await chromium.launch({headless:true,executablePath:'/home/hiroshi/.nix-profile/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1500,height:1060},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto('http://127.0.0.1:3210');await page.waitForFunction(()=>document.querySelector('#engine-label').textContent!=='モデルを確認中');
  await page.locator('#folder-path').fill(path.join(root,'examples/demo'));await page.locator('#folder-form button').click();await page.waitForFunction(()=>document.querySelector('#count-all').textContent==='3');
  await page.locator('[data-mode="concept"]').click();await page.locator('#trigger').fill('@demo_vase');await page.locator('#concept').fill('A ceramic vase with a wide rounded body and a narrow opening.');await page.locator('#learn').fill('the shape of the vase');await page.locator('#strategy-save').click();
  await page.locator('#bulk-open').click();await page.locator('#bulk-scope').selectOption('all');await page.locator('#bulk-find').fill('rust-colored');await page.locator('#bulk-replace').fill('terracotta-colored');await page.locator('#bulk-preview').click();await page.waitForFunction(()=>document.querySelector('#bulk-count').textContent.startsWith('1件'));await page.locator('#bulk-apply').click();await page.waitForFunction(()=>document.querySelector('#bulk-apply').disabled);await page.locator('#bulk-dialog .close').click();
  await page.locator('#save-one').click();await page.waitForTimeout(600);
  await page.locator('#training-open').click();await page.waitForSelector('#training-dialog[open]');await page.locator('#training-prepare').click();await page.waitForFunction(()=>document.querySelector('#training-start').disabled===false);await page.screenshot({path:path.join(root,'docs/training-preview.png')});await page.locator('#training-dialog .close').click();
  await page.screenshot({path:path.join(root,'docs/gui-preview.png')});
  console.log(JSON.stringify({ok:true,browserErrors:errors,caption:await page.locator('#caption').inputValue(),screenshots:['docs/gui-preview.png','docs/training-preview.png']}));
  if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close();}
