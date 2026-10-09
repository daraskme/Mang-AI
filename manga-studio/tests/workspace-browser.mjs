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
  const meter=page.locator('#workspace-progress .progress-overview progress');await expect(meter).toBeVisible();
  const job={id:'workspace-job',project:sessionKey('session-a'),pageId:'p1',status:'running',panels:['p1-c1','p1-c2','p1-c3'],completed:['p1-c1'],createdAt:new Date().toISOString(),progress:{panelId:'p1-c2',message:'サンプリング中',ratio:.5}};service.store.saveJob(job);
  await expect(meter).toHaveAttribute('value','0.5');await expect(page.locator('#gallery-frame')).toBeVisible();
  await expect(page.locator('#workspace-progress')).toContainText('現在のコマ 50%');
  assert.equal(await gallery.locator('#collections button').count(),1);assert.match(await gallery.locator('#title').innerText(),/雨上がり/);
  await gallery.locator('.card').click();await gallery.locator('#edit:not([disabled])').click();
  const edit=page.frameLocator('#editor-frame');await edit.locator('#selection').selectOption(bubble.id);await edit.locator('#text').fill('まだ保存していない台詞');
  await page.locator('[data-view=gallery]').click();await gallery.locator('[data-scope=all]').click();await expect(gallery.locator('#collections button')).toHaveCount(2);
  await gallery.locator('#collection-picker').selectOption({label:'別の作品'});await gallery.locator('.card').click();await gallery.locator('#edit:not([disabled])').click();
  await page.getByText('別の画像・ページを開く前に、編集中の文字やマスクを保存・処理してください。',{exact:true}).waitFor();
  assert.equal(await edit.locator('#text').inputValue(),'まだ保存していない台詞');assert.match(await edit.locator('#title').innerText(),/雨上がり/);
  await expect(meter).toBeVisible();assert.equal(await page.locator('#workspace-progress article.progress-card').count(),1);
  job.completed=[];job.progress.ratio=null;service.store.saveJob(job);await expect(meter).not.toHaveAttribute('value',/.+/);
  job.status='failed';job.error='検証用の生成エラー';service.store.saveJob(job);await expect(page.locator('#workspace-progress .progress-overview')).toContainText(job.error);
  job.status='completed';job.completed=[...job.panels];job.error=null;service.store.saveJob(job);await expect(meter).toHaveAttribute('value','1');
  await page.route('**/gallery/progress?*',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"検証用の一時切断"}'}));
  await expect(page.locator('#workspace-progress .progress-connection')).toContainText('表示は前回の状態');await expect(meter).toHaveAttribute('value','1');
  await page.unroute('**/gallery/progress?*');await expect(page.locator('#workspace-progress .progress-connection')).toContainText('自動更新');
  const media=service.studios.save('session-a','media',{provider:'h3',remoteId:'test-video'});
  service.studios.request=async()=>({status:'running',timing:{overall_percent:37},message:'動画の生成中'});
  await expect(page.locator(`[data-media="${media}"] progress`)).toHaveAttribute('value','0.37');await expect(page.locator(`[data-media="${media}"]`)).toContainText('動画の生成中');
  await page.locator('[data-view=editor]').click();assert.equal(await edit.locator('#text').inputValue(),'まだ保存していない台詞');await edit.locator('#save').click();await edit.getByText(/保存しました · revision/).waitFor();
  await page.locator('[data-view=gallery]').click();await gallery.locator('.card').click();await gallery.locator('#edit:not([disabled])').click();await edit.getByRole('heading',{name:'別の作品',exact:true}).waitFor();
  assert.equal(await edit.locator('#text').inputValue(),'');assert.equal(page.context().pages().length,1);
  await page.locator('[data-view=gallery]').click();await gallery.locator('[data-scope=session]').click();await gallery.locator('#group-picker').selectOption('projects');await expect(gallery.locator('#title')).toHaveText('雨上がりの手紙');await gallery.locator('.card').waitFor();
  const top=await page.locator('#gallery-frame').boundingBox(),first=await gallery.locator('.card').first().boundingBox();assert(first.y-top.y<=170,'Compact gallery should show media within 170px of the frame top');
  await gallery.locator('#search-toggle').click();await gallery.locator('#search').fill('ページ');await gallery.locator('#search-form').evaluate(form=>form.requestSubmit());await expect(gallery.locator('.card')).toHaveCount(1);
  await page.locator('[data-view=models]').click();await page.locator('[data-view=gallery]').click();assert.equal(await gallery.locator('#search').inputValue(),'ページ');
  await gallery.locator('#search').fill('');await gallery.locator('#search-form').evaluate(form=>form.requestSubmit());await gallery.locator('#search-toggle').click();
  await page.screenshot({path:root+'/workspace-desktop.png'});
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await gallery.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:root+'/workspace-mobile.png'});
  for(const width of [520,849,850,851]){await page.setViewportSize({width,height:900});assert(await gallery.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Gallery must fit at '+width);}
  await page.locator('[data-view=gallery]').focus();await page.keyboard.press('ArrowRight');await expect(page.locator('[data-view=generate]')).toHaveAttribute('aria-selected','true');await page.keyboard.press('Home');await expect(page.locator('[data-view=gallery]')).toHaveAttribute('aria-selected','true');
  await page.goto(editor.workspaceUrl(sessionKey('gallery'),'gallery')+'&session=new-session');await page.frameLocator('#gallery-frame').getByText('まだ登録されていません。制作を始めるとここに表示されます。',{exact:true}).waitFor();await page.frameLocator('#gallery-frame').locator('#create-media').click();await expect(page.locator('#generate-frame')).toBeVisible();assert.equal(service.store.db.prepare("SELECT count(*) AS count FROM integrations WHERE session=? AND kind='media'").get(sessionKey('new-session')).count,0);
  assert.deepEqual(errors.filter(e=>!e.includes('503 (Service Unavailable)')),[]);console.log('PASS unified workspace: default gallery and persistent progress, measured/unknown/failure/completion/disconnection, session filtering, guarded unsaved edits, empty session, mobile');
}finally{await browser.close();await editor.close();await service.close();}
