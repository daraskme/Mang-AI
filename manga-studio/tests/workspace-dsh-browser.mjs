// Read-only production UI check. TEST_URL is the active DSH URL, including its token.
// Unsaved text is changed only in this isolated browser and never submitted.
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
assert(process.env.TEST_URL,'TEST_URL is required');
const browser=await chromium.launch({headless:true,args:['--disable-gpu'],executablePath:process.env.CHROME_PATH||'/nix/store/i068vcjr9d1dk0ahikjpwgsncxbsslsf-google-chrome-153.0.8010.52/share/google/chrome/chrome'});
try{
  const page=await browser.newPage({viewport:{width:1700,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    if(route.request().resourceType()!=='script')return route.continue();
    const r=await route.fetch();let body=await r.text();if(body.includes('@mang-ai/local-runtime'))body=body.replace('function apply(ctx){','function apply(ctx){window.__testCtx=ctx;');await route.fulfill({response:r,body});
  });
  await page.goto(process.env.TEST_URL);await page.getByRole('button',{name:'▧ ギャラリー',exact:true}).waitFor();
  const notice=page.getByRole('button',{name:/^(Continue|続行|続ける)$/});if(await notice.count())await notice.click();
  await page.waitForFunction(()=>window.__testCtx?.get('sessions')?.list.getSnapshot().phase==='ready');
  const sessions=await page.evaluate(()=>{const s=window.__testCtx.get('sessions').list.getSnapshot();return s.ids.map(id=>({id,blank:s.byId[id].blank,running:s.byId[id].running}));});
  console.log('UI session metadata',JSON.stringify(sessions));assert(sessions.length,'A normal GUI session is required');
  const selected=process.env.TEST_SESSION||sessions.find(s=>!s.running)?.id;assert(selected);
  await page.evaluate(id=>window.__testCtx.get('uiWorkspace').openSession(id),selected);
  await page.getByRole('button',{name:'メディア',exact:true}).click();
  const shell=page.frameLocator('iframe[title="制作スペース"]:visible');await shell.locator('#workspace-title').waitFor();
  const src=await page.locator('iframe[title="制作スペース"]:visible').getAttribute('src');assert.equal(new URLSearchParams(new URL(src).hash.slice(1)).get('session'),selected);
  const gallery=shell.frameLocator('#gallery-frame');await gallery.getByRole('button',{name:'すべての素材',exact:true}).click();
  await gallery.getByRole('button',{name:/雨上がりの忘れ物/}).click();await gallery.locator('.card').first().click();await gallery.locator('#edit:not([disabled])').click();
  const edit=shell.frameLocator('#editor-frame');await edit.getByRole('heading',{name:'雨上がりの忘れ物',exact:true}).waitFor();
  await expect(edit.locator('#productionProgress [data-stage="export"]')).toHaveAttribute('data-state','completed');
  const option=await edit.locator('#selection option').nth(1).getAttribute('value');await edit.locator('#selection').selectOption(option);const original=await edit.locator('#text').inputValue();await edit.locator('#text').fill('統合画面の未保存テスト');
  await page.getByRole('button',{name:'◷ 制作の進捗',exact:true}).click();await expect(shell.locator('[data-view=progress]')).toHaveAttribute('aria-pressed','true');
  await shell.locator('[data-view=editor]').click();assert.equal(await edit.locator('#text').inputValue(),'統合画面の未保存テスト');
  const other=sessions.find(s=>s.id!==selected&&!s.running);
  if(other){await page.evaluate(id=>window.__testCtx.get('uiWorkspace').openSession(id),other.id);await page.getByRole('button',{name:'▧ ギャラリー',exact:true}).click();await expect(page.locator('iframe[title="制作スペース"]:visible')).toHaveAttribute('src',new RegExp(other.id));await page.evaluate(id=>window.__testCtx.get('uiWorkspace').openSession(id),selected);assert.equal(await edit.locator('#text').inputValue(),'統合画面の未保存テスト');}
  await edit.locator('#text').fill(original);await shell.locator('[data-view=gallery]').click();await mkdir('.test-output',{recursive:true});await page.screenshot({path:'.test-output/unified-dsh-desktop.png'});
  assert.equal(page.context().pages().length,1);assert.deepEqual(errors,[]);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.test-output/unified-dsh-mobile.png'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log('PASS real DSH: inline media dock, selected-session scope, actual comic editor/export progress, draft preservation, no extra tabs'+(other?', session switching':''));
}finally{await browser.close();}
