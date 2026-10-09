// Real DSH GUI in an isolated profile. No prompts, generation, or external models.
import {chromium,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {config,tempRoot,png,script,bubble} from './fixtures.js';
import {configure} from '../scripts/configure.mjs';
import {MangaService} from '../src/service.js';
import {sessionKey} from '../src/store.js';
const root=await tempRoot('session-dock'),c=config(join(root,'data'));delete c.remoteOrigin;delete c.remotePort;c.library=join(root,'library.json');await writeFile(c.library,'{"items":[]}');await writeFile(join(root,'config.json'),JSON.stringify(c));
process.env.MANGA_STUDIO_CONFIG=join(root,'config.json');process.env.DSH_HOME=join(root,'dsh');
const {patchPath}=await configure({patchPath:join(root,'overlay.yml')}),require=createRequire(import.meta.url),bin=join(dirname(require.resolve('@deepseek-ai/dsh/package.json')),'lib/bin.js');
const child=spawn(process.execPath,[bin,'--profile','manga','--patch',patchPath,'--port','0','--no-open'],{cwd:root,env:{...process.env,MANGA_AGENT_API_KEY:'local',MANGA_QWEN_API_KEY:'local',MANGA_CODER_API_KEY:'local'},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);let browser;
try{
  const deadline=Date.now()+60000;while(!/dsh web: (http\S+)/.test(log)){assert(child.exitCode===null,'DSH startup failed: '+log.replace(/token=[^\s&]+/g,'token=REDACTED'));assert(Date.now()<deadline,'DSH startup timed out');await new Promise(r=>setTimeout(r,200));}
  const url=log.match(/dsh web: (http\S+)/)[1];browser=await chromium.launch({headless:true,args:['--disable-gpu'],executablePath:process.env.CHROME_PATH||'/nix/store/i068vcjr9d1dk0ahikjpwgsncxbsslsf-google-chrome-153.0.8010.52/share/google/chrome/chrome'});
  const context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{if(route.request().resourceType()!=='script')return route.continue();const r=await route.fetch();let body=await r.text();if(body.includes('@mang-ai/local-runtime'))body=body.replace('function apply(ctx){','function apply(ctx){window.__testCtx=ctx;');await route.fulfill({response:r,body});});
  await page.route('**/gallery/models?*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({items:[{key:'test-model',id:'test-model',name:'検証用モデル',kind:'model',available:true},{key:'test-lora',id:'test-lora',name:'検証用LoRA',kind:'lora',available:true}],selection:null})}));
  await page.goto(url);const notice=page.getByRole('button',{name:/^(Continue|続行|続ける)$/});await page.waitForTimeout(1500);if(await notice.count())await notice.click();
  await page.waitForFunction(()=>window.__testCtx?.get('sessions')?.list.getSnapshot().phase==='ready');
  const sessions=await page.evaluate(async path=>{const ctx=window.__testCtx,workspace=await ctx.get('workspaces').create({path}),ids=[];for(let i=0;i<2;i++)ids.push(await ctx.get('sessions').create({workspaceId:workspace.workspaceId}));return ids;},root);
  await page.waitForFunction(ids=>ids.every(id=>window.__testCtx.get('workspaces').list.getSnapshot().items.some(workspace=>workspace.sessionIds.includes(id))),sessions);
  const service=new MangaService(c,{});for(const [index,id]of sessions.entries()){service.create(id,{title:'統合画面テスト '+index,brief:'検証'});service.setScript(id,{script,revision:1});service.letter(id,{revision:2,pageId:'p1',action:'upsert',bubble});const dir=join(service.store.directory(sessionKey(id)),'media');await mkdir(dir,{recursive:true});await writeFile(join(dir,'test-'+index+'.png'),png);service.studios.save(id,'media',{provider:'krea',remoteId:'test-'+index,lastProgress:{state:'completed',ratio:1}});}await service.close();
  await page.evaluate(id=>window.__testCtx.get('uiWorkspace').openSession(id),sessions[0]);
  const strip=page.frameLocator('iframe[title="この会話のメディア"]:visible');await strip.locator('#recent button').first().waitFor();await strip.locator('#recent button').first().click();await expect(strip.locator('#reference')).toBeVisible();
  const draft=page.locator('[data-composer-input]:visible');await expect(draft).toBeEditable();await draft.fill('送信しない下書き',{timeout:5000});await expect(draft).toHaveText('送信しない下書き');
  // The gallery is part of the default conversation; no launcher click needed.
  const workspace=page.frameLocator('iframe[title="制作スペース"]:visible');await expect(workspace.locator('#workspace-title')).toHaveText('統合画面テスト 0');
  await expect(workspace.locator('#gallery-frame')).toBeVisible();await expect(workspace.locator('#workspace-progress progress').first()).toBeVisible();
  const accountFrame=page.locator('iframe[title="このセッションのAI担当"]:visible');
  await expect(page.frameLocator('iframe[title="このセッションのAI担当"]:visible').locator('#assignment-settings')).toBeHidden();
  await page.waitForTimeout(200);assert((await accountFrame.boundingBox()).height<85,'The closed account selector should fit in one row');
  assert.equal(new URLSearchParams(new URL(await accountFrame.getAttribute('src')).hash.slice(1)).get('session'),sessions[0]);
  await expect(workspace.frameLocator('#workspace-quota').locator('#quota')).toContainText('Codex / Devin 未選択');
  const quotaBox=await workspace.locator('#workspace-quota').boundingBox(),progressBox=await workspace.locator('#workspace-progress').boundingBox();assert(quotaBox.y+quotaBox.height<=progressBox.y+1);
  await page.frameLocator('iframe[title="このセッションのAI担当"]:visible').locator('#open-agent').click();
  await expect(page.frameLocator('iframe[title="コーディング担当との会話"]:visible').locator('#agent-prompt')).toBeVisible();
  await page.evaluate(()=>window.__testCtx.sidebarRight.openTab('mang-ai-media'));
  assert(new URL(await page.locator('iframe[title="制作スペース"]:visible').getAttribute('src')).pathname.startsWith('/mang-ai/'));
  await workspace.locator('[data-view=generate]').click();await workspace.frameLocator('#generate-frame').locator('#prompt').fill('生成しないプロンプト');
  await workspace.locator('[data-view=gallery]').click();await workspace.locator('[data-view=generate]').click();assert.equal(await workspace.frameLocator('#generate-frame').locator('#prompt').inputValue(),'生成しないプロンプト');assert.equal(await draft.evaluate(e=>e.value??e.textContent),'送信しない下書き');
  await page.evaluate(id=>window.__testCtx.get('uiWorkspace').openSession(id),sessions[1]);await expect(strip.locator('#reference')).toBeHidden();await expect(workspace.locator('#workspace-title')).toHaveText('統合画面テスト 1');
  await expect(accountFrame).toHaveAttribute('src',new RegExp('session='+sessions[1]));
  await page.evaluate(id=>window.__testCtx.get('uiWorkspace').openSession(id),sessions[0]);await expect(strip.locator('#reference')).toBeVisible();assert.equal(await draft.evaluate(e=>e.value??e.textContent),'送信しない下書き');
  await workspace.locator('[data-view=gallery]').click();await workspace.frameLocator('#gallery-frame').locator('#group-picker').selectOption('projects');
  // Exercise the real persisted Harness preference, not a synthetic body color.
  const themeButton=page.locator('#mang-ai-theme-toggle');await expect(themeButton).toBeVisible();
  const buttonBox=await themeButton.boundingBox();assert(buttonBox.x<280&&buttonBox.y>800,'Theme control belongs at the bottom left');
  await workspace.locator('[data-view=models]').click();const models=workspace.frameLocator('#models-frame');
  await models.getByRole('checkbox').check();await models.getByRole('spinbutton').fill('0.6');
  await workspace.locator('[data-view=editor]').click();const edit=workspace.frameLocator('#editor-frame');
  await edit.locator('#selection').selectOption(bubble.id);await edit.locator('#text').fill('テーマ切替でも残す台詞');
  const svg=await edit.locator('#canvas').innerHTML();
  const sourceUrls=await workspace.locator('main>iframe').evaluateAll(frames=>frames.map(frame=>frame.src));
  for(const theme of ['dark','light']){
    await page.getByRole('button',{name:theme==='dark'?'ダークモードに切り替え':'ライトモードに切り替え',exact:true}).click();
    await expect(page.locator('html')).toHaveAttribute('data-ds-theme-source',theme);
    for(const id of ['gallery','generate','models','editor'])await expect(workspace.frameLocator('#'+id+'-frame').locator('html')).toHaveAttribute('data-theme',theme);
    const palette=await page.evaluate(()=>({background:getComputedStyle(document.body).backgroundColor,color:getComputedStyle(document.body).color,radius:getComputedStyle(document.body).getPropertyValue('--dsw-radius-md').trim()}));
    await workspace.locator('[data-view=generate]').click();
    await expect(workspace.frameLocator('#generate-frame').locator('body')).toHaveCSS('background-color',palette.background);
    await expect(workspace.frameLocator('#generate-frame').locator('body')).toHaveCSS('color',palette.color);
    await expect(workspace.frameLocator('#generate-frame').locator('#submit')).toHaveCSS('border-radius',palette.radius);
    assert.equal(await workspace.frameLocator('#generate-frame').locator('#prompt').inputValue(),'生成しないプロンプト');
    await workspace.frameLocator('#generate-frame').locator('body').evaluate(()=>scrollTo(0,0));await page.screenshot({path:join(root,'theme-generate-'+theme+'.png')});
    await workspace.locator('[data-view=models]').click();await expect(models.locator('body')).toHaveCSS('background-color',palette.background);assert.equal(await models.getByRole('spinbutton').inputValue(),'0.6');
    await page.screenshot({path:join(root,'theme-models-'+theme+'.png')});
    await workspace.locator('[data-view=editor]').click();await expect(edit.locator('.inspector')).toHaveCSS('background-color',palette.background);await expect(edit.locator('.paper')).toHaveCSS('background-color','rgb(255, 255, 255)');await expect(edit.locator('.progress-card').first()).toHaveCSS('color',palette.color);if(theme==='dark')await expect(edit.locator('.progress-card').first()).not.toHaveCSS('background-color','rgb(255, 255, 255)');
    assert.equal(await edit.locator('#text').inputValue(),'テーマ切替でも残す台詞');assert.equal(await edit.locator('#canvas').innerHTML(),svg);assert.deepEqual(await workspace.locator('main>iframe').evaluateAll(frames=>frames.map(frame=>frame.src)),sourceUrls);
    await edit.locator('body').evaluate(()=>scrollTo(0,0));await page.screenshot({path:join(root,'theme-editor-'+theme+'.png')});
    assert.equal(await draft.evaluate(e=>e.value??e.textContent),'送信しない下書き');
  }
  // Host Settings changes must also update the footer and mounted frames.
  await page.evaluate(()=>window.__testCtx.theme.setTheme('dark'));await expect(themeButton).toHaveAttribute('aria-pressed','true');await expect(edit.locator('html')).toHaveAttribute('data-theme','dark');
  await page.waitForTimeout(800);
  const freshContext=await browser.newContext(),fresh=await freshContext.newPage();await fresh.goto(url);await expect(fresh.locator('html')).toHaveAttribute('data-ds-theme-source','dark');await fresh.reload();await expect(fresh.locator('html')).toHaveAttribute('data-ds-theme-source','dark');await freshContext.close();
  const standalone=await page.context().newPage();await standalone.goto(await workspace.locator('#generate-frame').getAttribute('src'));await expect(standalone.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('button',{name:'ライトモードに切り替え',exact:true}).click();await expect(standalone.locator('html')).toHaveAttribute('data-theme','light');await standalone.close();
  await workspace.locator('[data-view=gallery]').click();
  await page.screenshot({path:join(root,'session-dock-desktop.png')});await page.setViewportSize({width:390,height:844});
  await expect(strip.locator('#inline-progress progress').first()).toBeVisible();await draft.click();await expect(draft).toBeFocused();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await expect.poll(async()=>{const box=await accountFrame.boundingBox();return box.x>=0&&box.x+box.width<=390;}).toBe(true);await expect(themeButton).toHaveText('');assert((await themeButton.boundingBox()).height<=40);await page.screenshot({path:join(root,'session-dock-mobile.png')});
  await page.setViewportSize({width:1600,height:1000});await expect(workspace.locator('#workspace-title')).toHaveText('統合画面テスト 0');await workspace.locator('[data-view=generate]').click();assert.equal(await workspace.frameLocator('#generate-frame').locator('#prompt').inputValue(),'生成しないプロンプト');
  // A user-collapsed pane stays collapsed when returning to this session.
  await page.evaluate(()=>window.__testCtx.sidebarRight.toggleExpanded());await page.evaluate(id=>window.__testCtx.get('uiWorkspace').openSession(id),sessions[1]);await page.evaluate(id=>window.__testCtx.get('uiWorkspace').openSession(id),sessions[0]);
  assert.equal(await page.evaluate(()=>window.__testCtx.sidebarRight.isExpanded()),false);assert.equal(await draft.evaluate(e=>e.value??e.textContent),'送信しない下書き');assert.deepEqual(errors,[]);
  await page.getByRole('button',{name:'プラグイン',exact:true}).click();
  await page.getByText('AIアカウント',{exact:true}).click();
  await expect(page.frameLocator('iframe[title="AIアカウント設定"]:visible').locator('#add-account')).toBeVisible();assert.deepEqual(errors,[]);
  // A bookmarked account tab may retain a capability from a previous server.
  // Recover it from the authenticated DSH page, never an anonymous token API.
  const accountUrl=new URL(await page.locator('iframe[title="AIアカウント設定"]:visible').getAttribute('src'));
  const expired=new URL(accountUrl);const hash=new URLSearchParams(expired.hash.slice(1));hash.set('token','synthetic-expired');expired.hash=hash.toString();
  await page.goto(expired.href);await expect(page.locator('#connection')).toBeHidden();await expect(page.locator('#add-account button')).toBeEnabled();
  assert.notEqual(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('token'),'synthetic-expired');
  await page.reload();await expect(page.locator('#connection')).toBeHidden();
  const anonymous=await browser.newContext();const unauthenticated=await anonymous.request.get(new URL('/',accountUrl).href);assert.equal(unauthenticated.status(),401);assert(!(await unauthenticated.text()).includes('__MANGAI_ACCOUNTS__'));await anonymous.close();
  console.log('PASS real DSH: gallery, quota above progress, per-session account frames, coding agent pane, references, draft preservation, responsive progress, collapsed preference');
}finally{if(browser)await browser.close();child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve();},5000).unref();});}
