// Real Harness, isolated profile and HTTPS tunnel. No production credentials or models.
import {chromium,expect} from '@playwright/test';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import assert from 'node:assert/strict';
import {config,tempRoot} from './fixtures.js';
import {configure} from '../scripts/configure.mjs';

const root=await tempRoot('remote-settings'),c=config(join(root,'data'));
execFileSync(process.env.OPENSSL_PATH||'openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem'),'-days','1','-subj','/CN=mang-ai.test'],{stdio:'ignore'});
let upstream;
const proxy=https.createServer({key:await readFile(join(root,'key.pem')),cert:await readFile(join(root,'cert.pem'))},(req,res)=>{
  if(!upstream){res.writeHead(503);res.end();return;}
  const request=http.request({hostname:'127.0.0.1',port:upstream.port,path:req.url,method:req.method,headers:{...req.headers,'x-forwarded-proto':'https'}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
  request.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});res.on('close',()=>request.destroy());req.pipe(request);
});
await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
const port=proxy.address().port,origin=`https://mang-ai.test:${port}`,alternate=`https://alternate.test:${port}`;
c.remoteOrigin=origin;delete c.remotePort;c.library=join(root,'library.json');await writeFile(c.library,'{"items":[]}');await writeFile(join(root,'config.json'),JSON.stringify(c));
process.env.MANGA_STUDIO_CONFIG=join(root,'config.json');process.env.DSH_HOME=join(root,'dsh');
const {patchPath}=await configure({patchPath:join(root,'overlay.yml')}),require=createRequire(import.meta.url),bin=join(dirname(require.resolve('@deepseek-ai/dsh/package.json')),'lib/bin.js');
const child=spawn(process.execPath,[bin,'--profile','manga','--patch',patchPath,'--port','0','--no-open','--trusted-host',new URL(origin).host,'--trusted-host',new URL(alternate).host],{cwd:root,env:{...process.env,MANGA_AGENT_API_KEY:'local',MANGA_QWEN_API_KEY:'local',MANGA_CODER_API_KEY:'local'},stdio:['ignore','pipe','pipe']});
let log='',browser;child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
try{
  const deadline=Date.now()+60000;while(!/dsh web: (http\S+)/.test(log)){assert(child.exitCode===null,'Isolated DSH startup failed');assert(Date.now()<deadline,'Isolated DSH startup timed out');await new Promise(r=>setTimeout(r,200));}
  upstream=new URL(log.match(/dsh web: (http\S+)/)[1]);
  browser=await chromium.launch({headless:true,args:['--disable-gpu','--no-proxy-server','--host-resolver-rules=MAP mang-ai.test 127.0.0.1, MAP alternate.test 127.0.0.1'],executablePath:process.env.CHROME_PATH||'/nix/store/i068vcjr9d1dk0ahikjpwgsncxbsslsf-google-chrome-153.0.8010.52/share/google/chrome/chrome'});
  async function open(base,{authenticated=true,upstreamClient=false}={}){
    const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1400,height:1000}}),page=await context.newPage();
    await page.route('**/*',async route=>{
      if(route.request().resourceType()!=='script')return route.continue();
      const target=new URL(route.request().url());
      const response=await route.fetch({url:upstream.origin+target.pathname+target.search,headers:{...await route.request().allHeaders(),host:target.host}});let body=await response.text();
      if(body.includes('@mang-ai/local-runtime'))body=body.replace('function apply(ctx){','function apply(ctx){window.__testCtx=ctx;');
      if(upstreamClient)body=body.replace('const persistence = (ctx.remote.$host.isLoopback || (globalThis.location?.protocol === "https:" && globalThis.location.origin === globalThis.__MANGAI_SETTINGS_ORIGIN__)) ? "host" : "memory";','const persistence = ctx.remote.$host.isLoopback ? "host" : "memory";');
      await route.fulfill({response,body});
    });
    const response=await page.goto(base+(authenticated?upstream.pathname+upstream.search:'/'));
    if(!authenticated)return {context,page,response};
    const notice=page.getByRole('button',{name:/^(Continue|続行|続ける)$/});
    await expect.poll(async()=>await notice.count()||await page.locator('#mang-ai-theme-toggle').count()).toBeGreaterThan(0);
    if(await notice.count())await notice.click();
    await page.waitForFunction(()=>window.__testCtx?.configForms);
    return {context,page,response};
  }
  async function models(page){
    await page.getByRole('button',{name:/^(設定|Settings)$/}).click();
    await page.getByRole('button',{name:/^(モデル|Models)$/}).click();
  }
  // The old upstream client reproduces the user's precise error at a remote URL.
  const old=await open(origin,{upstreamClient:true});await models(old.page);
  await expect(old.page.getByText(/settings are unavailable in this browser/)).toBeVisible();await old.context.close();
  const {page,context}=await open(origin),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await models(page);
  await expect(page.getByRole('button',{name:'モデルプロバイダーを追加',exact:true})).toBeVisible();
  await expect(page.getByText(/プロバイダーディレクトリの読み込みに失敗/)).toHaveCount(0);
  assert.equal(await page.evaluate(()=>window.__testCtx.get('remote').$host.isLoopback),false);
  assert.equal(await page.evaluate(()=>window.__testCtx.configForms.describe().getSnapshot().status),'ready');
  // Preserve the Host's existing refusal for values locked by a startup overlay.
  assert.equal(await page.evaluate(()=>window.__testCtx.configForms.get('mang-ai-local-runtime').set('timeoutMs',19000)),false);
  await page.getByRole('button',{name:/DeepSeek.*を編集/}).click();
  await page.getByText('カスタマイズされた設定',{exact:true}).click();
  await page.getByRole('textbox',{name:'ベースURL',exact:true}).fill('http://127.0.0.1:9/test-api');
  await page.getByRole('button',{name:'適用',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'ベースURL',exact:true})).toHaveCount(0);
  await page.screenshot({path:join(root,'remote-model-settings.png')});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'ダークモードに切り替え',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__testCtx.configForms.get('ui-theme').getSnapshot().value?.preference)).toBe('dark');
  const fresh=await open(origin);await models(fresh.page);
  await expect(fresh.page.getByRole('button',{name:'モデルプロバイダーを追加',exact:true})).toBeVisible();
  await expect(fresh.page.locator('html')).toHaveAttribute('data-ds-theme-source','dark');
  assert.equal(await fresh.page.evaluate(()=>window.__testCtx.configForms.get('llm-deepseek').getSnapshot().value.baseURL),'http://127.0.0.1:9/test-api');
  await fresh.page.reload();await expect(fresh.page.locator('html')).toHaveAttribute('data-ds-theme-source','dark');await fresh.context.close();
  const local=await open(upstream.origin);assert.equal(await local.page.evaluate(()=>window.__testCtx.get('remote').$host.isLoopback),true);
  await expect.poll(()=>local.page.evaluate(()=>window.__testCtx.configForms.describe().getSnapshot().status)).toBe('ready');await local.context.close();
  const other=await open(alternate);assert.equal(await other.page.evaluate(()=>window.__testCtx.configForms.describe().getSnapshot().status),'unavailable');await other.context.close();
  const anonymous=await open(origin,{authenticated:false});assert.equal(anonymous.response.status(),401);assert(!(await anonymous.page.content()).includes('__MANGAI_SETTINGS_ORIGIN__'));
  const unauthenticatedRpc=await anonymous.context.request.post(upstream.origin+'/api/rpc',{headers:{host:new URL(origin).host,origin},data:{}});assert.equal(unauthenticatedRpc.status(),401);await anonymous.context.close();
  const cookies=await context.cookies(origin);
  const untrustedRpc=await context.request.post(upstream.origin+'/api/rpc',{headers:{host:new URL(origin).host,origin:'https://untrusted.example',cookie:cookies.map(row=>row.name+'='+row.value).join('; ')},data:{}});assert.equal(untrustedRpc.status(),403);
  assert.deepEqual(errors,[]);await context.close();
  console.log('PASS remote settings: original bug reproduced; HTTPS directory loads; host writes and theme persist; localhost works; other origins unchanged; anonymous index/RPC denied');
}finally{
  if(browser)await browser.close();proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));
  child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve();},5000).unref();});
}
