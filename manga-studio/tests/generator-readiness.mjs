// Browser regression for a cold local studio; no systemd or GPU operations.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {MangaService} from '../src/service.js';
import {startEditor} from '../src/editor-server.js';
import {config,tempRoot} from './fixtures.js';

const c=config(await tempRoot('readiness-browser')),service=new MangaService(c,{});
const editor=await startEditor(service,0);
const browser=await chromium.launch({headless:true,args:['--disable-gpu'],executablePath:process.env.CHROME_PATH||'/nix/store/i068vcjr9d1dk0ahikjpwgsncxbsslsf-google-chrome-153.0.8010.52/share/google/chrome/chrome'});
try {
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const pending={ready:false,status:'starting',note:'生成環境は起動準備中です。しばらく待って一覧を更新してください。'};
  await page.route('**/generate/service',route=>route.fulfill({json:pending}));
  await page.route('**/generate/status',route=>route.fulfill({json:pending}));
  await page.goto(editor.generationUrl('readiness','readiness'));
  await page.locator('#start').click();await page.waitForFunction(note=>document.querySelector('#status').textContent===note,pending.note);
  await page.locator('#refresh').click();await page.waitForFunction(note=>document.querySelector('#status').textContent===note,pending.note);
  assert.deepEqual(errors,[]);console.log('PASS generator: cold-start note survives start and refresh without a model-list crash');
} finally {await browser.close();await editor.close();await service.close();}
