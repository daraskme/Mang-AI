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
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{if(route.request().resourceType()!=='script')return route.continue();const r=await route.fetch();let body=await r.text();if(body.includes('@mang-ai/local-runtime'))body=body.replace('function apply(ctx){','function apply(ctx){window.__testCtx=ctx;');await route.fulfill({response:r,body});});
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
  assert(new URL(await page.locator('iframe[title="制作スペース"]:visible').getAttribute('src')).pathname.startsWith('/mang-ai/'));
  await workspace.locator('[data-view=generate]').click();await workspace.frameLocator('#generate-frame').locator('#prompt').fill('生成しないプロンプト');
  await workspace.locator('[data-view=gallery]').click();await workspace.locator('[data-view=generate]').click();assert.equal(await workspace.frameLocator('#generate-frame').locator('#prompt').inputValue(),'生成しないプロンプト');assert.equal(await draft.evaluate(e=>e.value??e.textContent),'送信しない下書き');
  await page.evaluate(id=>window.__testCtx.get('uiWorkspace').openSession(id),sessions[1]);await expect(strip.locator('#reference')).toBeHidden();await expect(workspace.locator('#workspace-title')).toHaveText('統合画面テスト 1');
  await page.evaluate(id=>window.__testCtx.get('uiWorkspace').openSession(id),sessions[0]);await expect(strip.locator('#reference')).toBeVisible();assert.equal(await draft.evaluate(e=>e.value??e.textContent),'送信しない下書き');
  await workspace.locator('[data-view=gallery]').click();await page.screenshot({path:join(root,'session-dock-desktop.png')});await page.setViewportSize({width:390,height:844});
  await expect(strip.locator('#inline-progress progress').first()).toBeVisible();await draft.click();await expect(draft).toBeFocused();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(root,'session-dock-mobile.png')});
  await page.setViewportSize({width:1600,height:1000});await expect(workspace.locator('#workspace-title')).toHaveText('統合画面テスト 0');await workspace.locator('[data-view=generate]').click();assert.equal(await workspace.frameLocator('#generate-frame').locator('#prompt').inputValue(),'生成しないプロンプト');
  // A user-collapsed pane stays collapsed when returning to this session.
  await page.evaluate(()=>window.__testCtx.sidebarRight.toggleExpanded());await page.evaluate(id=>window.__testCtx.get('uiWorkspace').openSession(id),sessions[1]);await page.evaluate(id=>window.__testCtx.get('uiWorkspace').openSession(id),sessions[0]);
  assert.equal(await page.evaluate(()=>window.__testCtx.sidebarRight.isExpanded()),false);assert.equal(await draft.evaluate(e=>e.value??e.textContent),'送信しない下書き');assert.deepEqual(errors,[]);
  console.log('PASS real DSH: default gallery with persistent bars, explicit references, session isolation, draft preservation, responsive inline progress, collapsed preference');
}finally{if(browser)await browser.close();child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve();},5000).unref();});}
