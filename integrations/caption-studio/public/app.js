const $=id=>document.getElementById(id);
const token=document.querySelector('meta[name="studio-token"]').content;
const state={project:null,job:null,engine:null,selected:new Set(),active:null,filter:'all',dirty:false,metadataDirty:false,strategyDirty:false,presets:null,browsePath:null};
const settingsKeys=['trigger','classNoun','concept','learn','describe','attributePolicy','length','language','visibleText','metadata','extra','temperature','maxTokens','timeout'];
let mode='character',toastTimer;
async function api(route,data) {
  const res=await fetch('/api/'+route,{method:data===undefined?'GET':'POST',headers:{'X-Studio-Token':token,...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});
  const value=await res.json();if(!res.ok)throw new Error(value.error||`HTTP ${res.status}`);return value;
}
function toast(text,error=false){$('toast').textContent=text;$('toast').classList.toggle('error',error);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,error?10000:4000);}
function on(id,event,fn){$(id).addEventListener(event,async e=>{try{await fn(e);}catch(err){toast(err.message,true);}});}
function item(){return state.project?.items.find(i=>i.id===state.active);}
function busy(){return ['running','stopping'].includes(state.job?.state);}
function imageUrl(id){return `/image/${id}?token=${encodeURIComponent(token)}`;}
function el(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
function filtered(){const q=$('search').value.toLowerCase();return (state.project?.items||[]).filter(i=>(!q||i.relative.toLowerCase().includes(q)) && (state.filter==='all'||state.filter==='empty'&&!i.caption.trim()||state.filter==='review'&&!i.reviewed||state.filter==='error'&&i.error));}
function loadSettings(){if(!state.project)return;const p=state.project.settings;mode=p.mode;for(const k of settingsKeys)$(k).value=p[k]??'';renderMode();state.strategyDirty=false;}
function readSettings(){return {mode,...Object.fromEntries(settingsKeys.map(k=>[k,$(k).value]))};}
function renderMode(){document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));$('strategy-summary').textContent=state.presets?.[mode]?.summary||'';}
async function saveStrategy(){if(!state.project)throw new Error('先に画像フォルダを開いてください');state.project=await api('settings',readSettings());state.strategyDirty=false;render();}
async function flushDraft(){if(!item())return;if(state.dirty||state.metadataDirty){const patch={id:state.active};if(state.dirty)patch.caption=$('caption').value;if(state.metadataDirty)patch.metadata=$('item-metadata').value;state.project=await api('item',patch);state.dirty=state.metadataDirty=false;}}
async function activate(id){await flushDraft();state.active=id;renderEditor(true);renderGallery();}
let gallerySignature='';
function renderGallery(){const items=filtered();const signature=JSON.stringify(items.map(i=>[i.id,i.caption,i.reviewed,i.error,i.status,state.selected.has(i.id),i.id===state.active]));if(gallerySignature===signature)return;gallerySignature=signature;
  const fragment=document.createDocumentFragment();
  for(const i of items){const card=el('article','image-card'+(i.id===state.active?' active':''));card.tabIndex=0;card.setAttribute('aria-label',i.relative);card.addEventListener('click',()=>activate(i.id).catch(e=>toast(e.message,true)));card.addEventListener('keydown',e=>{if(e.key==='Enter')activate(i.id).catch(e=>toast(e.message,true));});
    const thumb=el('div','thumb'),img=el('img');img.src=imageUrl(i.id);img.loading='lazy';img.alt=i.relative;thumb.append(img);card.append(thumb);
    const label=el('label','card-check'),check=el('input');check.type='checkbox';check.checked=state.selected.has(i.id);check.setAttribute('aria-label',i.relative+'を選択');label.addEventListener('click',e=>e.stopPropagation());check.addEventListener('change',()=>{check.checked?state.selected.add(i.id):state.selected.delete(i.id);$('selection-count').textContent=state.selected.size+'枚 選択中';});label.append(check);card.append(label);
    if(i.reviewed||i.error||i.status==='generating')card.append(el('span','badge'+(i.error?' error':''),i.error?'要確認':i.status==='generating'?'生成中…':'✓ 確認済'));
    const meta=el('div','card-meta');meta.append(el('strong','',i.relative),el('small','',i.caption?(i.dirty?'● 下書きあり':'✓ .txt 読込済み'):'○ 未生成'));card.append(meta);fragment.append(card);
  }$('gallery').replaceChildren(fragment);$('shown-count').textContent=items.length+'枚 表示';
}
function renderEditor(force=false){const i=item();$('editor').hidden=!i;$('editor-empty').hidden=!!i;if(!i)return;
  if(force||$('preview').dataset.id!==i.id){$('preview').src=imageUrl(i.id);$('preview').dataset.id=i.id;state.dirty=state.metadataDirty=false;}
  $('filename').textContent=i.relative;if(!state.dirty)$('caption').value=i.caption;if(!state.metadataDirty)$('item-metadata').value=i.metadata;
  $('warnings').textContent=i.warnings?.join(' / ')||'';$('item-error').textContent=i.error||'';$('review').textContent=i.reviewed?'✓ 確認済み':'✓ 確認済みにする';$('draft-status').textContent=state.dirty?'未保存の編集あり':i.dirty?'アプリ内の下書き · .txtは未更新':'.txtと同期済み';updateWordCount();
}
function updateWordCount(){const v=$('caption').value.trim();$('word-count').textContent=`${v?v.split(/\s+/).length:0} words · ${v.length}文字`;}
function renderJob(){const j=state.job,running=busy();$('generate').disabled=!state.project||running;$('job-stop').hidden=!running;$('job-progress').hidden=!j;$('job-progress').max=j?.total||1;$('job-progress').value=j?.done||0;$('generate-one').disabled=running;
  $('job-title').textContent=j?(running?'キャプションを生成中':j.state==='cancelled'?'生成を停止しました':j.state==='error'?'ジョブエラー':'生成完了'):'キャプションを生成';
  $('job-detail').textContent=j?`${j.done} / ${j.total} 枚 · エラー ${j.failed} 件${j.current?' · '+j.current:''}`:'生成結果は下書きとして保存されます';
  document.querySelectorAll('#strategy-form input,#strategy-form textarea,#strategy-form select,#strategy-form button,[data-mode]').forEach(e=>e.disabled=running);
}
function render(){const p=state.project,items=p?.items||[];const ready=items.filter(i=>i.caption.trim()).length,reviewed=items.filter(i=>i.reviewed).length;
  $('count-all').textContent=items.length;$('count-ready').textContent=ready;$('count-reviewed').textContent=reviewed;$('dataset-progress').style.width=(items.length?100*ready/items.length:0)+'%';$('progress-label').textContent=items.length?`${Math.round(100*ready/items.length)}% キャプションあり`:'フォルダを選んではじめましょう';$('dataset-info').textContent=p?`${items.length}枚 · ${p.source}`:'PNG / JPEG / WebP / BMP';$('empty-state').hidden=!!items.length;$('export-all').disabled=!ready;$('selection-count').textContent=state.selected.size+'枚 選択中';renderGallery();renderEditor();renderJob();}
function renderEngine(fill=false){const e=state.engine;if(!e)return;const label={ready:'準備完了',loading:'モデル読込中',offline:'モデル未接続',error:'接続エラー'}[e.health];$('engine-label').textContent=label;$('engine-dot').className='dot '+e.health;$('engine-status-text').textContent=`${label} · ${e.model||'127.0.0.1:'+e.config.port}${e.managed?' · このGUIが管理':''}`;$('engine-log').textContent=e.logs?.join('\n')||'起動ログはここに表示されます。';$('engine-stop').disabled=!e.managed;$('engine-start').disabled=e.managed||e.health!=='offline';if(fill)for(const [k,v]of Object.entries(e.config)){const field=$('engine-'+k);if(field){if(field.type==='checkbox')field.checked=v;else field.value=v;}}}
async function refreshEngine(fill=false){state.engine=await api('engine/status');renderEngine(fill);}
async function openFolder(folder){await flushDraft();state.project=await api('open',{folder,recursive:$('recursive').checked});localStorage.setItem('krea-folder',folder);$('folder-path').value=state.project.source;state.selected.clear();state.active=state.project.items[0]?.id||null;gallerySignature='';loadSettings();render();$('folder-dialog').close();toast(`${state.project.items.length}枚を読み込みました。既存の.txtも反映しました。`);}
async function browse(folder){const b=await api('browse?path='+encodeURIComponent(folder||''));state.browsePath=b.path;$('browse-path').value=b.path;$('browse-count').textContent=`この階層に画像 ${b.images}枚`;$('browse-up').dataset.path=b.parent;const f=document.createDocumentFragment();for(const name of b.folders){const button=el('button','', '▱　'+name);button.addEventListener('click',()=>browse(b.path+'/'+name).catch(e=>toast(e.message,true)));f.append(button);}$('folder-list').replaceChildren(f);}
async function openBrowser(){await browse($('folder-path').value||'/run/media/hiroshi/ボリューム/krea2');$('folder-dialog').showModal();}
async function generate(ids,overwrite){await flushDraft();if(state.strategyDirty)await saveStrategy();state.job=await api('job/start',{ids,overwrite});renderJob();}
async function write(ids){await flushDraft();const r=await api('save',{ids});const current=await api('state');state.project=current.project;render();const msg=`${r.written}件 保存 · ${r.skipped}件 変更なし${r.errors.length?'\n'+r.errors.map(e=>`${e.file}: ${e.error}`).join('\n'):''}`;toast(msg,!!r.errors.length);return msg;}
function idsFor(scope){return(state.project?.items||[]).filter(i=>scope==='all'||scope==='selected'&&state.selected.has(i.id)||scope==='reviewed'&&i.reviewed).map(i=>i.id);}
for(const d of document.querySelectorAll('dialog'))d.querySelector('.close')?.addEventListener('click',()=>d.close());
on('folder-form','submit',async e=>{e.preventDefault();await openFolder($('folder-path').value);});
on('browse-open','click',openBrowser);on('empty-browse','click',openBrowser);on('browse-form','submit',async e=>{e.preventDefault();await browse($('browse-path').value);});on('browse-up','click',()=>browse($('browse-up').dataset.path));on('folder-choose','click',()=>openFolder(state.browsePath));
on('strategy-form','submit',async e=>{e.preventDefault();await saveStrategy();toast('キャプション方針を保存しました');});
$('strategy-form').addEventListener('input',()=>state.strategyDirty=true);
for(const b of document.querySelectorAll('[data-mode]'))b.addEventListener('click',()=>{mode=b.dataset.mode;const preset=state.presets[mode];$('learn').value=preset.learn;$('describe').value=preset.describe;$('classNoun').value=mode==='character'?'person':mode==='concept'?'object':'';state.strategyDirty=true;renderMode();});
for(const b of document.querySelectorAll('[data-filter]'))b.addEventListener('click',()=>{state.filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(e=>e.classList.toggle('active',e===b));gallerySignature='';renderGallery();});
on('search','input',()=>renderGallery());on('select-all','click',()=>{const items=filtered(),all=items.every(i=>state.selected.has(i.id));for(const i of items)all?state.selected.delete(i.id):state.selected.add(i.id);gallerySignature='';render();});
on('caption','input',()=>{state.dirty=true;$('draft-status').textContent='未保存の編集あり';updateWordCount();});on('item-metadata','input',()=>state.metadataDirty=true);on('save-draft','click',async()=>{await flushDraft();render();toast('下書きを保存しました');});on('save-metadata','click',async()=>{await flushDraft();toast('画像の補足を保存しました');});on('review','click',async()=>{const reviewed=!item().reviewed;await flushDraft();state.project=await api('item',{id:state.active,reviewed});render();});on('save-one','click',()=>write([state.active]));
on('preview','load',()=>{$('image-size').textContent=$('preview').naturalWidth+' × '+$('preview').naturalHeight;});
for(const [id,step]of [['prev',-1],['next',1]])on(id,'click',async()=>{const list=filtered(),index=list.findIndex(i=>i.id===state.active);if(list[index+step])await activate(list[index+step].id);});
on('generate','click',()=>generate(idsFor($('scope').value),$('overwrite').checked));on('generate-one','click',()=>generate([state.active],true));on('job-stop','click',async()=>{await api('job/stop',{});toast('停止処理を開始しました。完了した下書きは保持されます。');});
on('engine-open','click',async()=>{await refreshEngine(true);$('engine-dialog').showModal();});on('engine-form','submit',async e=>{e.preventDefault();const config=Object.fromEntries(Object.keys(state.engine.config).map(k=>[k,$('engine-'+k).type==='checkbox'?$('engine-'+k).checked:$('engine-'+k).value]));state.engine=await api('engine/config',config);renderEngine();toast('接続設定を保存しました');});on('engine-start','click',async()=>{await api('engine/start',{});toast('モデルを読み込んでいます');await refreshEngine();});on('engine-stop','click',async()=>{await api('engine/stop',{});toast('モデルを停止しています');});on('engine-check','click',()=>refreshEngine());
on('guide-open','click',()=>$('guide-dialog').showModal());on('prompt-open','click',async()=>{await flushDraft();if(state.strategyDirty)await saveStrategy();$('prompt-text').textContent=(await api('prompt'+(state.active?'?id='+state.active:''))).prompt;$('prompt-dialog').showModal();});
on('export-all','click',()=>$('export-dialog').showModal());on('export-confirm','click',async()=>{const ids=idsFor($('export-scope').value);if(!ids.length)throw new Error('書き出し対象がありません');$('export-result').textContent=await write(ids);});
on('manifest','click',async()=>{await flushDraft();const r=await fetch('/api/manifest',{headers:{'X-Studio-Token':token}});if(!r.ok)throw new Error('データセットを開いてください');const url=URL.createObjectURL(await r.blob()),a=el('a');a.href=url;a.download='captions.jsonl';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
window.addEventListener('beforeunload',e=>{if(state.dirty||state.metadataDirty||state.strategyDirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();flushDraft().then(()=>{render();toast('下書きを保存しました');}).catch(e=>toast(e.message,true));}});
async function init(){const b=await api('bootstrap');state.project=b.project;state.job=b.job;state.engine=b.engine;state.presets=b.presets;$('folder-path').value=state.project?.source||localStorage.getItem('krea-folder')||'';renderEngine();renderMode();for(const p of Object.values(b.presets)){const card=el('div','guide-card');card.append(el('h3','',p.name+' / '+p.subtitle),el('p','',p.summary),el('blockquote','',p.example));$('guide-presets').append(card);}for(const s of b.sources){const row=el('div'),a=el('a','',s.title+' ↗');a.href=s.url;a.target='_blank';a.rel='noreferrer';row.append(a,el('p','',s.note));$('sources').append(row);}if(state.project){state.active=state.project.items[0]?.id;loadSettings();}else{const defaults={trigger:'',classNoun:'person',concept:'',learn:b.presets.character.learn,describe:b.presets.character.describe,attributePolicy:'omit',length:'medium',language:'en',visibleText:'scene',metadata:'',extra:'',temperature:0.25,maxTokens:640,timeout:240};for(const k of settingsKeys)$(k).value=defaults[k];}render();}
await init().catch(e=>toast(e.message,true));
let polling=false,ticks=0;
setInterval(async()=>{if(polling)return;polling=true;try{if(state.project||busy()){const s=await api('state');state.project=s.project;state.job=s.job;render();}if(++ticks%4===0)await refreshEngine();if(window.refreshTraining)await window.refreshTraining();}catch{}finally{polling=false;}},1500);
// Extension panels share the same authenticated API and selection state.
export { $,state,api,on,toast,el,flushDraft,saveStrategy,idsFor,render,busy,write };
