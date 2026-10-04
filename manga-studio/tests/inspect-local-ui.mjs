import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const b=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/nix/store/i068vcjr9d1dk0ahikjpwgsncxbsslsf-google-chrome-153.0.8010.52/share/google/chrome/chrome'});
try{
const p=await b.newPage({viewport:{width:1440,height:1080}}),errors=[];
p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await p.route('**/*',async route=>{
 if(route.request().resourceType()!=='script')return route.continue();
 const r=await route.fetch();let body=await r.text();
 if(body.includes('@mang-ai/local-runtime'))body=body.replace('function apply(ctx){\n    ctx.effect', 'function apply(ctx){ window.__testCtx=ctx;\n    ctx.effect');
 const voice=body.indexOf('id: "@deepseek-ai/dsh-experimental-client-ui-voice-input"');
 if(voice>=0)body=body.slice(0,voice)+body.slice(voice).replace('function registerUi(ctx) {','function registerUi(ctx) { window.__testSpeech=ctx.remote.speech;');
 await route.fulfill({response:r,body});
});
await p.goto(process.env.TEST_URL||'http://127.0.0.1:4340/?token=h6-lwxlVKH-JiMhtzyWWNXffnG5fOv3buLADGcv9UK4');
await p.waitForTimeout(2500);
const notice=p.getByRole('button',{name:/^(Continue|続行|続ける)$/});if(await notice.count())await notice.click();
const galleryLink=p.getByRole('link',{name:'▧ ギャラリー'});await galleryLink.waitFor();
const galleryUrl=await galleryLink.getAttribute('href'),galleryHash=new URLSearchParams(new URL(galleryUrl).hash.slice(1));
const catalog=await fetch(`${new URL(galleryUrl).origin}/api/${galleryHash.get('project')}/gallery/collections`,{headers:{Authorization:`Bearer ${galleryHash.get('token')}`}}).then(r=>{assert.equal(r.status,200);return r.json();});
console.log('Gallery',JSON.stringify({datasets:catalog.items.filter(c=>c.group==='datasets').length,missing:catalog.items.filter(c=>c.missing).map(c=>({name:c.title,links:c.missing})),projects:catalog.items.filter(c=>c.group==='projects').length}));
if(process.env.TEST_DATASETS==='48')assert.equal(catalog.items.filter(c=>c.group==='datasets').length,48);
await p.getByRole('button',{name:/^(Plugins|プラグイン)$/}).click();await p.waitForTimeout(1200);
console.log((await p.locator('body').innerText()).slice(0,6500));
console.log('Context',await p.evaluate(()=>{const c=window.__testCtx;return c?{remote:Object.keys(c.get('remote')),locale:c.locale.snapshot}:null}));
if(process.env.TEST_SPEECH==='1'){
  await p.waitForFunction(()=>!!window.__testSpeech,{timeout:20000});
  console.log('Speech prepare',await p.evaluate(()=>window.__testSpeech.prepare('sensevoice-local',{})));
  const wave=Buffer.alloc(44+32000);wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(16000,24);wave.writeUInt32LE(32000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(32000,40);
  await p.waitForTimeout(3000);
  console.log('Speech transcribe',await p.evaluate(audioBase64=>window.__testSpeech.transcribe({audioBase64,providerId:'sensevoice-local',language:'ja'},new AbortController().signal),wave.toString('base64')));
}
await p.screenshot({path:'.test-output/plugins-ui.png'});
await writeFile('.test-output/ui-errors.json',JSON.stringify(errors,null,2));
if(errors.length)throw Error(errors.join('\n'));
}finally{await b.close();}
