import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {rm} from 'node:fs/promises';
import {MangaService} from '../src/service.js';
import {startEditor} from '../src/editor-server.js';
import {config,tempRoot,png} from './fixtures.js';
import {sessionKey} from '../src/store.js';

const root=await tempRoot('models-browser'),service=new MangaService(config(root),{});
service.studios.request=async(provider,path)=>provider==='h3'?{models:[{name:'H3'}],loras:[]} : path==='/api/models'?{items:[{id:'kroma',name:'Kroma'}]}:{items:[{id:'style',name:'漫画スタイル'},{id:'character',name:'人物LoRA'}]};
const editor=await startEditor(service,0),browser=await chromium.launch({headless:true,args:['--disable-gpu'],executablePath:process.env.CHROME_PATH||'/nix/store/i068vcjr9d1dk0ahikjpwgsncxbsslsf-google-chrome-153.0.8010.52/share/google/chrome/chrome'});
try{
  const page=await browser.newPage({viewport:{width:1000,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const url=editor.galleryUrl(sessionKey('catalog'),'catalog').replace('/gallery.html#','/models.html#')+'&session=one';
  await page.goto(url);await page.getByRole('heading',{name:'Kroma',exact:true}).waitFor();
  await page.getByRole('button',{name:'このモデルを選ぶ'}).click();
  const style=page.locator('.model-card').filter({has:page.getByRole('heading',{name:'漫画スタイル',exact:true})});
  await style.getByRole('checkbox').check();await style.getByRole('spinbutton').fill('0.6');await style.getByLabel('用途').selectOption('style');
  await page.locator('#refresh').click();await expect(style.getByRole('spinbutton')).toHaveValue('0.6');
  await page.locator('#provider').selectOption('h3');await page.getByRole('heading',{name:'H3',exact:true}).waitFor();
  await page.locator('#provider').selectOption('krea');await expect(style.getByRole('spinbutton')).toHaveValue('0.6');
  await style.locator('input[type=file]').setInputFiles({name:'thumb.png',mimeType:'image/png',buffer:png});await page.getByText('サムネイルを保存しました（全セッション共通）',{exact:true}).waitFor();
  await expect(style.locator('img')).toHaveJSProperty('naturalWidth',png.readUInt32BE(16));
  await style.getByRole('button',{name:'サムネイルを解除'}).click();await expect(style.locator('img')).toHaveCount(0);
  await style.getByLabel('登録する画像の種類').selectOption('generated');
  await style.locator('input[type=file]').setInputFiles({name:'thumb.png',mimeType:'image/png',buffer:png});await expect(style.locator('small').filter({hasText:'LoRAの生成例'})).toBeVisible();
  await page.locator('#save').click();await page.getByText('このセッションの生成に使う組合せを保存しました',{exact:true}).waitFor();
  await page.reload();await expect(style.getByRole('spinbutton')).toHaveValue('0.6');await expect(style.getByLabel('用途')).toHaveValue('style');
  assert.equal(service.studios.models.selected('one','krea').model,'kroma');assert.equal(service.studios.models.selected('two','krea'),null);
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:root+'/models-mobile.png'});assert.deepEqual(errors,[]);
  console.log('PASS model catalog: per-session selection, individual LoRA role/strength, draft retention, thumbnail upload, reload and mobile');
}finally{await browser.close();await editor.close();await service.close();await rm(root,{recursive:true,force:true});}
