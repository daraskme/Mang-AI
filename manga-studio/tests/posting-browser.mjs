import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {MangaService} from '../src/service.js';
import {startEditor} from '../src/editor-server.js';
import {config,tempRoot,png} from './fixtures.js';
import {sessionKey} from '../src/store.js';

assert(process.env.MANGAI_CAPTION_PYTHON,'Set MANGAI_CAPTION_PYTHON for the posting export integration test');
const root=await tempRoot('posting-browser'),c=config(join(root,'sessions')),dir=join(root,'datasets','sample');
await mkdir(dir,{recursive:true});await mkdir(join(root,'models'));c.library=join(root,'models','training-library.json');c.thumbnailPython=process.env.MANGAI_CAPTION_PYTHON;
await writeFile(c.library,JSON.stringify({items:[{kind:'dataset',family:'krea2',name:'sample',path:dir,images:1,videos:0}]}));await writeFile(join(dir,'sample.png'),png);
const service=new MangaService(c,{}),editor=await startEditor(service,0);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/nix/store/i068vcjr9d1dk0ahikjpwgsncxbsslsf-google-chrome-153.0.8010.52/share/google/chrome/chrome'});
try{
  const page=await browser.newPage({acceptDownloads:true});await page.goto(editor.galleryUrl(sessionKey('gallery'),'gallery'));
  await page.locator('[data-group=datasets]').click();await page.locator('#collections button').first().click();await page.locator('#grid .card').first().click();
  const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'投稿用に保存（生成情報・EXIFなし）'}).click();const download=await waiting;
  assert.equal(download.suggestedFilename(),'mangai-post.png');assert((await readFile(await download.path())).subarray(0,8).equals(png.subarray(0,8)));
  await expect(page.locator('#edit-status')).toContainText('元ファイルは保持');assert.deepEqual(await readFile(join(dir,'sample.png')),png);
  console.log('PASS posting export: authenticated gallery download, generic filename and unchanged original');
}finally{await browser.close();await editor.close();await service.close();await rm(root,{recursive:true,force:true});}
