import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {MangaService} from '../src/service.js';
import {startEditor} from '../src/editor-server.js';
import {config,tempRoot,script,bubble} from './fixtures.js';
import {sessionKey} from '../src/store.js';

const root=await tempRoot('workspace-browser'),c=config(root);c.library=join(root,'library.json');await writeFile(c.library,'{"items":[]}');
const service=new MangaService(c,{});
for(const [id,title]of [['session-a','雨上がりの手紙'],['session-b','別の作品']]){service.create(id,{title,brief:'画面統合の確認'});service.setScript(id,{script,revision:1});service.letter(id,{revision:2,pageId:'p1',action:'upsert',bubble});}
const editor=await startEditor(service,0),browser=await chromium.launch({headless:true,args:['--disable-gpu'],executablePath:process.env.CHROME_PATH||'/nix/store/i068vcjr9d1dk0ahikjpwgsncxbsslsf-google-chrome-153.0.8010.52/share/google/chrome/chrome'});
try{
  const page=await browser.newPage({viewport:{width:760,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const url=editor.workspaceUrl(sessionKey('gallery'),'gallery')+'&session=session-a';await page.goto(url);
  const gallery=page.frameLocator('#gallery-frame');await gallery.locator('.card').waitFor();
  assert.equal(await gallery.locator('#collections button').count(),1);assert.match(await gallery.locator('#title').innerText(),/雨上がり/);
  await gallery.locator('.card').click();await gallery.locator('#edit:not([disabled])').click();
  const edit=page.frameLocator('#editor-frame');await edit.locator('#selection').selectOption(bubble.id);await edit.locator('#text').fill('まだ保存していない台詞');
  await page.locator('[data-view=gallery]').click();await gallery.locator('[data-scope=all]').click();await expect(gallery.locator('#collections button')).toHaveCount(2);
  await gallery.getByRole('button',{name:/別の作品/}).click();await gallery.locator('.card').click();await gallery.locator('#edit:not([disabled])').click();
  await page.getByText('別の画像・ページを開く前に、編集中の文字やマスクを保存・処理してください。',{exact:true}).waitFor();
  assert.equal(await edit.locator('#text').inputValue(),'まだ保存していない台詞');assert.match(await edit.locator('#title').innerText(),/雨上がり/);
  await page.locator('[data-view=progress]').click();const progress=page.frameLocator('#progress-frame');await progress.locator('.progress-card').waitFor();assert.equal(await progress.locator('.progress-card').count(),1);
  await page.locator('[data-view=editor]').click();assert.equal(await edit.locator('#text').inputValue(),'まだ保存していない台詞');await edit.locator('#save').click();await edit.getByText(/保存しました · revision/).waitFor();
  await page.locator('[data-view=gallery]').click();await gallery.locator('.card').click();await gallery.locator('#edit:not([disabled])').click();await edit.getByRole('heading',{name:'別の作品',exact:true}).waitFor();
  assert.equal(await edit.locator('#text').inputValue(),'');assert.equal(page.context().pages().length,1);
  await page.locator('[data-view=gallery]').click();await gallery.locator('[data-scope=session]').click();await gallery.getByRole('heading',{name:'雨上がりの手紙',exact:true}).waitFor();
  await page.screenshot({path:root+'/workspace-desktop.png'});
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await gallery.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:root+'/workspace-mobile.png'});
  await page.goto(editor.workspaceUrl(sessionKey('gallery'),'gallery')+'&session=new-session');await page.frameLocator('#gallery-frame').getByText('まだ登録されていません。制作を始めるとここに表示されます。',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);console.log('PASS unified workspace: session filtering, all media, in-place editing, unsaved text retained and guarded, progress, empty session, mobile');
}finally{await browser.close();await editor.close();await service.close();}
