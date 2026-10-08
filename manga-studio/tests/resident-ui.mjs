// Production GUI inspection; optional explicit migration only changes old Qwen session routing.
// No prompts are sent, no new models loaded, no model/LoRA selections changed.
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
assert(process.env.TEST_URL,'TEST_URL is required');
const browser=await chromium.launch({headless:true,args:['--disable-gpu'],executablePath:process.env.CHROME_PATH||'/nix/store/i068vcjr9d1dk0ahikjpwgsncxbsslsf-google-chrome-153.0.8010.52/share/google/chrome/chrome'});
try{
  const page=await browser.newPage({viewport:{width:1700,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{if(route.request().resourceType()!=='script')return route.continue();const r=await route.fetch();let body=await r.text();if(body.includes('@mang-ai/local-runtime'))body=body.replace('function apply(ctx){','function apply(ctx){window.__testCtx=ctx;').replace("inject:['locale'","inject:['remote.session','locale'");await route.fulfill({response:r,body});});
  await page.goto(process.env.TEST_URL);await page.getByRole('button',{name:'▧ ギャラリー',exact:true}).waitFor();
  const notice=page.getByRole('button',{name:/^(Continue|続行|続ける)$/});if(await notice.count())await notice.click();
  await page.waitForFunction(()=>window.__testCtx?.get('sessions')?.list.getSnapshot().phase==='ready');
  const catalog=await page.evaluate(()=>window.__testCtx.get('remote').session.modelCatalog());
  console.log('Model catalog',JSON.stringify(catalog));
  assert(JSON.stringify(catalog).includes('agents-a1-4b-q8'));assert(JSON.stringify(catalog).includes('qwen3.8-flash-next-q8-strata'));
  const sessions=await page.evaluate(()=>{const s=window.__testCtx.get('sessions').list.getSnapshot();return s.ids.filter(id=>!s.byId[id].running&&!s.byId[id].blank);});
  if(process.env.MIGRATE_LEGACY==='1'){
    const migrated=await page.evaluate(async ids=>{const api=window.__testCtx.get('remote').session,out=[];for(const sessionId of ids){const result=await api.projections({sessionId});if(!result.ok)throw Error(JSON.stringify(result));const selected=result.value?.values?.modelSelection?.next;if(selected?.model==='qwen3.8-27b-local'){const changed=await api.selectModel({sessionId,provider:'manga-agent',model:'agents-a1-4b-q8'});if(!changed.ok)throw Error(JSON.stringify(changed));out.push(sessionId);}}return out;},sessions);
    console.log('Migrated legacy sessions',JSON.stringify(migrated));
  }
  assert(sessions.length);await page.evaluate(id=>window.__testCtx.get('uiWorkspace').openSession(id),sessions[0]);await page.getByRole('button',{name:'メディア',exact:true}).click();
  const workspace=page.frameLocator('iframe[title="制作スペース"]:visible');await workspace.locator('[data-view=models]').click();
  const models=workspace.frameLocator('#models-frame');await models.locator('.model-card').first().waitFor();const krea=await models.locator('.model-card').count();assert(krea>1);
  await models.locator('#provider').selectOption('h3');await expect(models.locator('#status')).not.toContainText('一覧を読み込んでいます');await models.locator('.model-card').first().waitFor();const h3=await models.locator('.model-card').count();assert(h3>1);
  await workspace.locator('[data-view=progress]').click();await workspace.frameLocator('#progress-frame').getByLabel('GPUとメモリの使用状況').getByText(/Agents A1 4B/).waitFor();
  await page.screenshot({path:'.test-output/resident-gpu-ui.png'});assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'PASS',kreaCatalogEntries:krea,h3CatalogEntries:h3}));
}finally{await browser.close();}
