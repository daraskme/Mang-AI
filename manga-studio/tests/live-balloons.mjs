// Explicit live-model test. Notify the user before running: Gemma and Kroma use GPU/RAM.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from '@playwright/test';
import {loadConfig,packageRoot} from '../src/config.js';
import {Store} from '../src/store.js';
import {LocalStudios} from '../src/local-studios.js';
import {balloonInstruction} from '../src/balloons.js';
import {pageSVG} from '../src/render.js';
import {embeddedLetteringFont} from '../src/lettering-font.js';

const root=join(packageRoot,'.test-output','balloons-live-'+Date.now());await mkdir(root,{recursive:true});
const config=loadConfig(),store=new Store(root),studios=new LocalStudios(config,store,{}),session='balloons-live';
const signal=AbortSignal.timeout(900000);let browser;
try{
  const status=await studios.status('krea',signal);assert(status.models.items.some(m=>m.id==='kroma-v03-turbo'&&m.available));
  console.log('Gemma: writing a single-panel visual prompt');
  const creative=process.argv[2]?JSON.parse(await readFile(join(process.argv[2],'request.json'),'utf8')).creative:await studios.prompt(session,{provider:'krea',instruction:'動作確認用の日本漫画の1コマ。架空の大人の女性が自宅リビングの窓辺でコーヒーカップを持ち、画面外の相手へ声をかける。穏やかな朝、上半身、フルカラー。女性を左下寄りに配置し、右上の縦長の空間を空吹き出し用に空ける。人物は1人。文字そのものは描かない。',context:{style:'Hand-drawn full-color Japanese manga',preserve:'One person, uncluttered upper-right area. The rendering tool adds the empty balloon instruction.'}},signal);
  const page={id:'p1',layout:'縦2（上大）',purpose:'空吹き出しと源暎アンチックの表示試験',panels:[{id:'p1-c1',dialogue:[{speaker:'女性',text:'コーヒー、\n冷めるよ。'}]},{id:'p1-c2',dialogue:[]}],bubbles:[{id:'sample',kind:'speech',direction:'vertical',shape:'auto',speaker:'女性',text:'コーヒー、\n冷めるよ。',x:700,y:75,width:230,height:330,fontSize:38,tailX:650,tailY:400}]};
  const request={model_id:'kroma-v03-turbo',preset:'turbo8',steps:8,width:576,height:512,seed:6426,loras:[{id:'user/style/krea2_manga_style.safetensors',weight:0.6,enabled:true}],prompt:creative.prompt+'\n'+balloonInstruction(page,page.panels[0],'generated')};
  assert(request.prompt.length<=4000);await writeFile(join(root,'request.json'),JSON.stringify({creative,request},null,2));
  console.log('Kroma: generating one panel with one empty balloon');
  const submitted=await studios.generate(session,'krea',request,signal);let result,previous='';
  while(true){
    result=await studios.job(session,submitted.id,'status',signal);
    const stage=result.job.stage||result.job.status;if(stage!==previous){console.log(stage);previous=stage;}
    if(['completed','failed','cancelled'].includes(result.job.status))break;
    await delay(1500,undefined,{signal});
  }
  await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));assert.equal(result.job.status,'completed',JSON.stringify(result.job));
  const bytes=await readFile(result.outputPath);page.panels[0].image=result.outputPath;page.panels[0].balloonMode='generated';
  const svg=pageSVG(page,{'p1-c1':'data:image/png;base64,'+bytes.toString('base64')},false,await embeddedLetteringFont());
  await writeFile(join(root,'page.svg'),svg);await writeFile(join(root,'page.json'),JSON.stringify(page,null,2));
  browser=await chromium.launch({headless:true,args:['--disable-gpu'],executablePath:process.env.CHROME_PATH||'/nix/store/i068vcjr9d1dk0ahikjpwgsncxbsslsf-google-chrome-153.0.8010.52/share/google/chrome/chrome'});
  const view=await browser.newPage({viewport:{width:1000,height:1414}});await view.goto('file://'+join(root,'page.svg'));await view.evaluate(()=>document.fonts.ready);
  await view.screenshot({path:join(root,'lettered-panel.png'),clip:{x:28,y:28,width:944,height:840}});
  console.log('PASS live Gemma → Kroma empty-balloon request → embedded-font lettering. Visual fit must be checked:',root);
  console.log('Raw image:',result.outputPath);
}finally{if(browser)await browser.close();store.close();}
