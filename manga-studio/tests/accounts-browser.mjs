// Isolated GUI test; every CLI response is synthetic and no inference is sent.
import {chromium,expect} from '@playwright/test';
import {EventEmitter} from 'node:events';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {ExternalAccounts} from '../src/external-accounts.js';
import {ExternalAgentJobs} from '../src/external-agent-jobs.js';
import {MangaService} from '../src/service.js';
import {startEditor} from '../src/editor-server.js';
import {tempRoot,config} from './fixtures.js';
const root=await tempRoot('accounts-browser'),service=new MangaService(config(join(root,'studio')),{});let stored;
const accounts=new ExternalAccounts({directory:join(root,'accounts'),credentials:{describe:async()=>({configured:!!stored,writable:true}),set:async(_k,v)=>{stored=v;},unset:async()=>{stored=null;}}});
const codex=accounts.add({provider:'codex',label:'仕事用'}),devin=accounts.add({provider:'devin',label:'個人用'});
accounts.live.set(codex.id,{authenticated:true,models:[{id:'codex-model',name:'Codex model'}],quota:{updatedAt:Date.now(),windows:[{label:'Codex',minutes:300,remainingPercent:75,resetsAt:1800000000}]}});
accounts.live.set(devin.id,{authenticated:true,models:[{id:'devin-model',name:'Devin model'}],quota:{updatedAt:Date.now(),windows:[{label:'週次',minutes:10080,remainingPercent:56,resetsAt:1800600000}]}});
accounts.refresh=async id=>accounts.live.get(id);
accounts.select('session-a',{accountId:codex.id,model:'codex-model'});accounts.select('session-b',{accountId:devin.id,model:'devin-model'});
let counter=0;
accounts.connect=async id=>{const rpc=new EventEmitter();rpc.request=async(method,p)=>{
  if(method==='session/new')return {sessionId:'synthetic-'+(++counter),configOptions:[{id:'model',category:'model'}]};
  if(method==='session/set_config_option')return {configOptions:[{id:p.configId,currentValue:p.value}]};
  if(method==='session/prompt'){setTimeout(()=>jobs.notification(id,{method:'session/update',params:{sessionId:p.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'合成テストの応答です'}}}}),50);await new Promise(r=>setTimeout(r,100));return {stopReason:'end_turn'};}
  throw Error('Unexpected fake method '+method);
};rpc.send=()=>{};return rpc;};
const jobs=new ExternalAgentJobs(accounts,{sessionDirectory:()=>root});accounts.jobs=jobs;
const editor=await startEditor(service,0,accounts);let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/nix/store/i068vcjr9d1dk0ahikjpwgsncxbsslsf-google-chrome-153.0.8010.52/share/google/chrome/chrome',args:['--disable-gpu']});
  const page=await browser.newPage({viewport:{width:900,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const url=new URL(editor.accountsUrl());url.hash+='&view=agent&session=session-a';await page.goto(url.href);
  await expect(page.locator('#quota')).toContainText('残り 75%');await expect(page.locator('#quota')).toContainText('リセット');
  await page.locator('#agent-prompt').fill('送信前の下書き');await page.waitForTimeout(3200);assert.equal(await page.locator('#agent-prompt').inputValue(),'送信前の下書き');
  await page.locator('#session-account').selectOption(devin.id);await expect(page.locator('#session-model')).toHaveValue('devin-model');await page.locator('#save-selection').click();await expect(page.locator('#quota')).toContainText('残り 56%');assert.equal(accounts.selection('session-b').accountId,devin.id);
  await page.locator('#agent-prompt').fill('合成テストだけを実行');await page.getByRole('button',{name:'担当に送信'}).click();await expect(page.locator('#jobs')).toContainText('合成テストの応答です');await expect(page.locator('#jobs')).toContainText('完了');assert.equal(jobs.list('session-a')[0].model,'devin-model');assert.equal(jobs.list('session-b').length,0);
  await page.screenshot({path:join(root,'accounts-session.png')});
  const picker=new URL(editor.accountsUrl());picker.hash+='&view=session&session=session-a';await page.goto(picker.href);await expect(page.locator('#assignment-settings')).toBeHidden();await page.locator('#assignment-toggle').click();await page.locator('#session-account').selectOption(codex.id);await expect(page.locator('#assignment-dirty')).toBeVisible();assert.equal(accounts.selection('session-a').accountId,devin.id);await page.reload();await expect(page.locator('#assignment-settings')).toBeVisible();await expect(page.locator('#session-account')).toHaveValue(codex.id);await expect(page.locator('#quota')).toContainText('残り 56%');
  const other=new URL(editor.accountsUrl());other.hash+='&view=session&session=session-b';await page.goto(other.href);await expect(page.locator('#assignment-dirty')).toBeHidden();await expect(page.locator('#session-account')).toHaveValue(devin.id);await page.goto(picker.href);await page.locator('#cancel-selection').click();await expect(page.locator('#assignment-settings')).toBeHidden();assert.equal(accounts.selection('session-a').accountId,devin.id);
  const settings=new URL(editor.accountsUrl());await page.goto(settings.href);await expect(page.locator('#deepseek-key')).toBeEnabled();await page.locator('#deepseek-key').fill('synthetic-private-key');await page.getByRole('button',{name:'キーを保存'}).click();await expect(page.locator('#deepseek-state')).toHaveText('APIキー登録済み');assert.equal(stored,'synthetic-private-key');assert.equal(await page.locator('#deepseek-key').inputValue(),'');assert(!(await page.locator('body').innerText()).includes(stored));
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(root,'accounts-mobile.png')});assert.deepEqual(errors,[]);
  await page.reload();await expect(page.locator('#accounts .account')).toHaveCount(2);await expect(page.locator('#connection')).toBeHidden();
  const unavailable=route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"synthetic outage"}'});
  await page.route('**/api/accounts/state*',unavailable);await page.reload();await expect(page.locator('#connection')).toContainText('登録情報を読み込めていません');await expect(page.locator('#add-account button')).toBeDisabled();await expect(page.locator('#empty-accounts')).toBeHidden();
  await page.unroute('**/api/accounts/state*',unavailable);await page.locator('#retry-load').click();await expect(page.locator('#accounts .account')).toHaveCount(2);await expect(page.locator('#connection')).toBeHidden();await expect(page.locator('#add-account button')).toBeEnabled();assert.equal(accounts.state.accounts.length,2);
  console.log('PASS account UI: per-session model/account, remaining quota/reset, drafts, direct dispatch, private DeepSeek key, mobile');
}finally{await browser?.close();jobs.close();accounts.close();await editor.close();await service.close();}
