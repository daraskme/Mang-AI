// CPU/browser-only verification of Japanese vertical lettering and exported PNGs.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {MangaService} from '../src/service.js';
import {startEditor} from '../src/editor-server.js';
import {packageRoot} from '../src/config.js';
import {config,tempRoot,script,bubble} from './fixtures.js';

const root=await tempRoot('vertical'),service=new MangaService(config(root),{});
const session='vertical-browser',project=service.create(session,{title:'縦書きの確認',brief:'句読点・括弧・長音・列の読み順'});
service.setScript(session,{script,revision:1});
const lines=['「コーヒー、','冷めるよ。」','……本当？'];
const sample={...bubble,direction:undefined,text:lines.join('\n'),x:620,y:60,width:300,height:490,fontSize:36,tailX:940,tailY:520};
service.letter(session,{pageId:'p1',revision:2,action:'upsert',bubble:sample});
service.letter(session,{pageId:'p1',revision:3,action:'upsert',bubble:{...bubble,id:'convert',direction:'horizontal',text:'（まだ、温かい。）',x:290,y:70,width:280,height:440,fontSize:32,tailX:270,tailY:500}});
const editor=await startEditor(service,0),out=join(packageRoot,'.test-output');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--disable-gpu'],executablePath:process.env.CHROME_PATH||'/nix/store/i068vcjr9d1dk0ahikjpwgsncxbsslsf-google-chrome-153.0.8010.52/share/google/chrome/chrome'});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(editor.url(project.id));await page.locator('#title').filter({hasText:'縦書きの確認'}).waitFor();
  await page.locator('#selection').selectOption('b-test');
  assert.equal(await page.locator('#direction').inputValue(),'vertical');
  await page.evaluate(()=>document.fonts.ready);
  const geometry=await page.locator('[data-bubble="b-test"] text').evaluateAll(nodes=>nodes.map(n=>({
    text:n.textContent,x:Number(n.getAttribute('x')),mode:getComputedStyle(n).writingMode,
    glyphs:Array.from({length:n.getNumberOfChars()},(_,i)=>{const r=n.getExtentOfChar(i);return {x:r.x+r.width/2,y:r.y+r.height/2};}),
  })));
  assert.deepEqual(geometry.map(l=>l.text),lines);
  for(const [i,line] of geometry.entries()) {
    assert.equal(line.mode,'vertical-rl');
    if(i)assert(line.x<geometry[i-1].x,'Columns must advance from right to left');
    for(let j=1;j<line.glyphs.length;j++)assert(line.glyphs[j].y>line.glyphs[j-1].y,'Glyphs must advance downwards');
  }
  await page.locator('#canvas [data-bubble="b-test"]').screenshot({path:join(out,'vertical-lettering.png')});
  const before=structuredClone(service.status(session).project.pages[0]);
  await page.locator('#verticalize').click();await page.waitForFunction(()=>document.querySelector('#verticalize').disabled);
  const after=service.status(session).project.pages[0];
  assert(after.bubbles.every(b=>b.direction==='vertical'));
  assert.deepEqual(after.bubbles.map(b=>b.text),before.bubbles.map(b=>b.text));
  assert.deepEqual(after.panels,before.panels);
  await page.reload();await page.locator('#selection').selectOption('convert');assert.equal(await page.locator('#direction').inputValue(),'vertical');
  for(const [id,name] of [['downloadSvg','vertical-page.svg'],['downloadPng','vertical-page.png']]) {
    const event=page.waitForEvent('download');await page.locator('#'+id).click();await(await event).saveAs(join(out,name));
  }
  const svg=await readFile(join(out,'vertical-page.svg'),'utf8');assert(svg.includes('writing-mode:vertical-rl'));assert(svg.includes('冷めるよ。」'));
  const png=await readFile(join(out,'vertical-page.png'));assert.equal(png.readUInt32BE(16),2000);assert.equal(png.readUInt32BE(20),2828);
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);console.log('PASS vertical dialogue: defaults, downward glyphs, right-to-left columns, page conversion, reload, SVG/PNG exports');
} finally {await browser.close();await editor.close();await service.close();await rm(root,{recursive:true,force:true});}
