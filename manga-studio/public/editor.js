import { pageSVG, bubbleLayout } from '/render.js';
import { LAYOUTS, PAGE_W, PAGE_H } from '/model.js';

const $=id=>document.getElementById(id);
const hash=new URLSearchParams(location.hash.slice(1));
const projectId=hash.get('project'),token=hash.get('token');
const galleryButton=document.createElement('button');galleryButton.textContent='ギャラリー';galleryButton.className='quiet';document.querySelector('.top-actions').prepend(galleryButton);
galleryButton.onclick=()=>act(async()=>{requireSaved();location.href=(await api('gallery')).url;});
let project=null,pageIndex=0,selected='',draft=null,dirty=false,busy=false,drag=null;
const imageURLs=new Map();
const fields=['speaker','text','kind','direction','x','y','width','height','fontSize','tailX','tailY'];
const numeric=new Set(['x','y','width','height','fontSize','tailX','tailY']);
const artSection=document.createElement('section');artSection.className='dialogues';
const artHeading=document.createElement('h2');artHeading.textContent='画像の修正・モザイク';
const artSelect=document.createElement('select');artSelect.id='artPanel';artSelect.setAttribute('aria-label','修正するコマ');
const artButton=document.createElement('button');artButton.id='editArtwork';artButton.textContent='画像編集を開く';
artSection.append(artHeading,artSelect,artButton);document.querySelector('.inspector').append(artSection);
const currentPage=()=>project?.pages[pageIndex];
function message(value,error=false){$('status').textContent=value;$('status').style.color=error?'#ac4f3d':'';}
async function api(action='',body) {
  const response=await fetch(`/api/${projectId}${action?'/'+action:''}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...body?{'Content-Type':'application/json'}:{}},...body?{body:JSON.stringify(body)}:{}});
  const result=await response.json();
  if(!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
async function act(fn){if(busy)return;busy=true;try{await fn();}catch(error){message(error.message,true);}finally{busy=false;}}
function requireSaved(){if(dirty)throw new Error('編集中の文字を先に保存してください');}
async function load(quiet=false){
  if(!projectId||!token){message('DSH の manga_open_editor から編集リンクを開いてください',true);return;}
  if(dirty){if(!quiet)message('未保存の文字があります。先に保存してください',true);return;}
  const result=await api();const firstLoad=!project;project=result.project;
  if(firstLoad&&hash.get('page'))pageIndex=Math.max(0,project.pages.findIndex(p=>p.id===hash.get('page')));
  pageIndex=Math.min(pageIndex,Math.max(0,project.pages.length-1));
  await loadImages();drawAll(result.jobs);
  if(!quiet)message(`保存済み · revision ${project.revision}`);
}
async function loadImages(){
  for(const panel of currentPage()?.panels||[]) if(panel.image&&!imageURLs.has(panel.image)){
    const response=await fetch(`/api/${projectId}/${panel.image}`,{headers:{Authorization:`Bearer ${token}`}});
    if(!response.ok)throw new Error('画像を読み込めませんでした');
    imageURLs.set(panel.image,URL.createObjectURL(await response.blob()));
  }
}
function drawAll(jobs=[]){
  $('title').textContent=project.title;$('brief').textContent=project.brief;$('pageCount').textContent=project.pages.length;
  document.title=project.title+' · Mang-AI';$('pages').replaceChildren();
  project.pages.forEach((p,i)=>{const button=document.createElement('button');button.className='page-button'+(i===pageIndex?' active':'');
    const num=document.createElement('span');num.className='page-number';num.textContent=String(i+1).padStart(2,'0');
    const desc=document.createElement('span');desc.textContent=p.purpose;button.append(num,desc);
    button.onclick=()=>act(async()=>{requireSaved();pageIndex=i;selected='';draft=null;await loadImages();drawAll(jobs);});$('pages').append(button);});
  const page=currentPage();$('purpose').textContent=page?.purpose||'DSH で脚本を作成してください';$('pageLabel').textContent=page?`PAGE ${String(pageIndex+1).padStart(2,'0')}`:'PAGE —';$('layout').textContent=page?`${page.layout} · 1000 × 1414`:'';
  artSelect.replaceChildren();page?.panels.forEach((p,i)=>{if(p.image)artSelect.add(new Option(`コマ ${i+1}`,p.id));});artButton.disabled=!artSelect.options.length;
  $('approve').textContent=project.approved?'脚本確定済み ✓':'脚本を確定';
  $('approve').disabled=!!project.approved||!page;$('render').disabled=!project.approved||!page;$('add').disabled=!page;
  $('selection').replaceChildren(new Option('選択してください',''));
  for(const b of page?.bubbles||[])$('selection').add(new Option((b.speaker?b.speaker+'：':'')+b.text.slice(0,18),b.id));
  selectBubble(selected);
  $('dialogues').replaceChildren();
  page?.panels.forEach((panel,i)=>panel.dialogue.forEach((line,j)=>{
    const div=document.createElement('div');div.className='dialogue';const label=document.createElement('small');label.textContent=`コマ ${i+1} · ${line.speaker}`;
    const p=document.createElement('p');p.textContent=line.text;const button=document.createElement('button');button.textContent='吹き出しに入力';
    button.onclick=()=>act(async()=>{requireSaved();await addBubble(line,i,j);});div.append(label,p,button);$('dialogues').append(div);
  }));
  $('jobs').replaceChildren();
  for(const job of jobs.slice(0,4)){
    const line=document.createElement('div');line.textContent=`${job.pageId} · ${job.status} (${job.completed.length}/${job.panels.length})`;
    if(['running','queued'].includes(job.status)){const stop=document.createElement('button');stop.textContent='中止';stop.onclick=()=>act(async()=>{await api('cancel',{jobId:job.id});message('中止を要求しました');});line.append(stop);}
    if(job.error){const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('p');summary.textContent='エラー';pre.textContent=job.error;details.append(summary,pre);line.append(details);}
    $('jobs').append(line);
  }
}
function selectBubble(id){
  selected=id;draft=structuredClone(currentPage()?.bubbles.find(b=>b.id===id)||null);$('selection').value=draft?id:'';
  for(const field of fields){$(field).value=draft?.[field]??'';$(field).disabled=!draft;}
  $('remove').disabled=!draft;$('save').disabled=!draft||!dirty;drawCanvas();
}
function drawCanvas(){
  const page=currentPage();if(!page){$('canvas').replaceChildren();return;}
  const copy=structuredClone(page);if(draft){const i=copy.bubbles.findIndex(b=>b.id===draft.id);if(i>=0)copy.bubbles[i]=draft;}
  const images=Object.fromEntries(copy.panels.filter(p=>p.image).map(p=>[p.id,imageURLs.get(p.image)]));
  $('canvas').innerHTML=pageSVG(copy,images,true);
  for(const group of $('canvas').querySelectorAll('[data-bubble]'))group.classList.toggle('selected',group.dataset.bubble===selected);
  $('overflow').textContent=draft&&bubbleLayout(draft).overflow?'文字が収まりません。幅・高さ・文字サイズ・改行を調整してください。':'';
}
function syncDraft(){if(!draft)return;for(const f of fields)draft[f]=numeric.has(f)?Number($(f).value):$(f).value;dirty=true;$('save').disabled=false;drawCanvas();message('未保存の変更');}
for(const field of fields)$(field).addEventListener('input',syncDraft);
$('selection').onchange=()=>{if(dirty){$('selection').value=selected;message('先に文字を保存してください',true);return;}selectBubble($('selection').value);};
async function addBubble(line={speaker:'',text:'台詞を入力'},panelIndex=0,lineIndex=0){
  const page=currentPage();if(!page)throw new Error('先に脚本を作成してください');
  const [x,y,w,h]=LAYOUTS[page.layout][panelIndex],width=Math.min(185,w-32),height=Math.min(280,h-32);
  const bubble={id:'b-'+crypto.randomUUID(),speaker:line.speaker,text:line.text,kind:'speech',direction:'vertical',x:lineIndex%2===0?x+w-width-14:x+14,y:y+16,width,height,fontSize:28,tailX:x+w/2,tailY:Math.min(y+h-12,y+height+60)};
  const result=await api('letter',{pageId:page.id,action:'upsert',bubble,revision:project.revision});
  project=result.project;selected=bubble.id;dirty=false;drawAll();message('吹き出しを追加しました');
}
$('add').onclick=()=>act(async()=>{requireSaved();await addBubble();});
$('save').onclick=()=>act(async()=>{
  if(!draft)return;
  const result=await api('letter',{pageId:currentPage().id,action:'upsert',bubble:draft,revision:project.revision});
  project=result.project;dirty=false;drawAll();message(`保存しました · revision ${project.revision}`);
});
$('remove').onclick=()=>act(async()=>{if(!draft)return;const result=await api('letter',{pageId:currentPage().id,action:'delete',id:draft.id,revision:project.revision});project=result.project;selected='';draft=null;dirty=false;drawAll();message('吹き出しを削除しました');});
function point(event){const rect=$('canvas').getBoundingClientRect();return{x:(event.clientX-rect.left)/rect.width*PAGE_W,y:(event.clientY-rect.top)/rect.height*PAGE_H};}
$('canvas').addEventListener('pointerdown',event=>{
  const hit=event.target.closest('[data-hit]');if(!hit)return;
  const id=hit.dataset.hit;if(dirty&&id!==selected){message('先に文字を保存してください',true);return;}
  if(id!==selected)selectBubble(id);
  drag={start:point(event),original:structuredClone(draft)};$('canvas').setPointerCapture(event.pointerId);event.preventDefault();
});
$('canvas').addEventListener('pointermove',event=>{
  if(!drag)return;const p=point(event);draft.x=Math.round(Math.max(0,Math.min(PAGE_W-draft.width,drag.original.x+p.x-drag.start.x)));draft.y=Math.round(Math.max(0,Math.min(PAGE_H-draft.height,drag.original.y+p.y-drag.start.y)));
  $('x').value=draft.x;$('y').value=draft.y;dirty=true;$('save').disabled=false;drawCanvas();
});
$('canvas').addEventListener('pointerup',()=>{if(drag)message('位置を変更しました。保存してください');drag=null;});
$('canvas').addEventListener('pointercancel',()=>{drag=null;});
$('refresh').onclick=()=>act(()=>load());
artButton.onclick=()=>act(async()=>{requireSaved();message('画像編集を準備しています');const result=await api('open-edit',{pageId:currentPage().id,panelId:artSelect.value});location.href=result.url;});
$('approve').onclick=()=>act(async()=>{requireSaved();const result=await api('approve',{revision:project.revision});project=result.project;drawAll();message('脚本を確定しました。作画を開始できます');});
$('render').onclick=()=>act(async()=>{requireSaved();const {job}=await api('render',{pageId:currentPage().id});message(`Krea 2 の生成キューに追加しました · ${job.id.slice(0,8)}`);await load(true);});
$('script').onclick=()=>{if(!project)return;const script={pages:project.pages.map(({layout,purpose,panels})=>({layout,purpose,panels:panels.map(({action,artPrompt,dialogue})=>({action,artPrompt,dialogue}))}))};$('scriptText').value=JSON.stringify(script,null,2);$('scriptDialog').showModal();};
$('closeScript').onclick=()=>$('scriptDialog').close();
$('saveScript').onclick=()=>act(async()=>{requireSaved();const result=await api('script',{script:JSON.parse($('scriptText').value),revision:project.revision});project=result.project;pageIndex=0;selected='';draft=null;drawAll();$('scriptDialog').close();message('脚本を保存しました。内容を確認し、確定してください');});
$('export').onclick=()=>act(async()=>{requireSaved();const result=await api('export',{});message(`保存先：${result.directory}${result.warnings.length?' ／ '+result.warnings.join(' ／ '):''}`);});
async function svgForDownload(){
  requireSaved();const page=currentPage();if(!page)throw new Error('ページがありません');const images={};
  for(const panel of page.panels)if(panel.image){const blob=await(await fetch(imageURLs.get(panel.image))).blob();images[panel.id]=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});}
  return pageSVG(page,images);
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
$('downloadSvg').onclick=()=>act(async()=>{download(new Blob([await svgForDownload()],{type:'image/svg+xml'}),`${currentPage().id}.svg`);});
$('downloadPng').onclick=()=>act(async()=>{
  const svg=await svgForDownload();await document.fonts.ready;const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
  try{const img=new Image();img.src=url;await img.decode();const canvas=document.createElement('canvas');canvas.width=2000;canvas.height=2828;canvas.getContext('2d').drawImage(img,0,0,2000,2828);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('PNG を書き出せませんでした');download(blob,`${currentPage().id}.png`);}finally{URL.revokeObjectURL(url);}
});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
setInterval(()=>{if(!busy&&!dirty&&project&&!$('scriptDialog').open&&!document.querySelector('input:focus,textarea:focus,select:focus'))act(()=>load(true));},4000);
act(()=>load());
