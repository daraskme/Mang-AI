const $=id=>document.getElementById(id),hash=new URLSearchParams(location.hash.slice(1));
const key=hash.get('project'),token=hash.get('token');let current,serial=0,modelCatalog=[],selectedWeights=new Map();
const galleryButton=document.createElement('button');galleryButton.textContent='メディアギャラリー';document.querySelector('h1').after(galleryButton);
galleryButton.onclick=async()=>{try{const r=await fetch(`/api/${key}/gallery`,{headers:{Authorization:`Bearer ${token}`}});const v=await r.json();if(!r.ok)throw Error(v.error);location.href=v.url;}catch(e){$('status').textContent=e.message;}};
async function api(action,body){const r=await fetch(`/api/${key}/generate/${action}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...body===undefined?{}:{'Content-Type':'application/json'}},body:body===undefined?undefined:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw Error(value.error);return value;}
const show=v=>{$('result').textContent=JSON.stringify(v,null,2)};
const run=fn=>async()=>{try{$('status').textContent='処理中…';await fn();if($('status').textContent==='処理中…')$('status').textContent='更新しました';}catch(e){$('status').textContent=e.message;}};
function args(){const provider=$('provider').value,a={provider,prompt:$('prompt').value,seed:Number($('seed').value)};if(provider==='longvideo')Object.assign(a,{model:$('model').value,shot_seconds:Number($('shot').value),megapixels:Number($('mp').value),steps:$('quality').value==='draft'?4:8,resolution:$('ratio').value,latent_upscale:$('latent').value});else Object.assign(a,{[provider==='krea'?'model_id':'model']:$('model').value,width:Number($('width').value),height:Number($('height').value),preset:$('quality').value==='draft'?(provider==='krea'?'fast4':'turbo4'):'turbo8',...provider==='h3'?{frames:Number($('frames').value)}:{}});if(provider!=='krea'&&$('first').value.trim())a.firstFramePath=$('first').value.trim();return a;}
async function refresh(){
 const p=$('provider').value,s=await api('status',{provider:p});if(s.ready===false)throw Error(s.note);$('model').replaceChildren();
 const list=p==='longvideo'?s.models:p==='krea'?s.models.items:s.models.models;
 modelCatalog=list;
 for(const m of list){const value=typeof m==='string'?m:(m.id||m.path||m.name);const o=new Option(typeof m==='string'?m:(m.label||m.name||value),value);o.disabled=m.available===false;if(p==='longvideo'&&value.includes('TurboV3'))o.selected=true;$('model').add(o);}
 if(s.selection?.model)$('model').value=s.selection.model;
 updatePresets();
 $('latent').replaceChildren(new Option('使用しない','off'));
 if(p==='longvideo')for(const value of s.options.optional.latent_upscale[0].filter(x=>x!=='off'))$('latent').add(new Option(value,value));
 $('loras').replaceChildren();
 const adapters=p==='longvideo'?s.loras:p==='krea'?s.loras.items:s.models.loras;
 selectedWeights=new Map((s.selection?.loras||[]).filter(l=>l.enabled!==false).map(l=>[l.id,l.weight]));
 for(const lora of adapters){const id=typeof lora==='string'?lora:(lora.id||lora.name);const option=new Option(typeof lora==='string'?lora:(lora.name||id),id);option.disabled=lora.available===false;option.selected=selectedWeights.has(id);$('loras').add(option);}
}
function updatePresets(){const model=modelCatalog.find(m=>m.id===$('model').value),draft=$('quality').querySelector('option[value="draft"]');draft.disabled=$('provider').value==='krea'&&model?.supported_presets&&!model.supported_presets.includes('fast4');if(draft.disabled&&$('quality').value==='draft')$('quality').value='balanced';}
$('model').onchange=updatePresets;
async function history(){const rows=await api('history');$('history').replaceChildren();for(const row of rows){const b=document.createElement('button');b.textContent=`${row.provider} · ${row.request.prompt?.slice(0,30)||'高解像度化'} · ${row.id.slice(0,8)}`;b.onclick=run(()=>follow(row.id));$('history').append(b);}}
async function follow(id){current=id;const ticket=++serial;$('output').replaceChildren();$('cancel').disabled=false;$('upscale').disabled=true;async function poll(){if(ticket!==serial)return;try{const r=await api('job',{id,action:'status'});if(ticket!==serial)return;show(r);const done=!['running','queued','loading','generating'].includes(r.job.status);$('cancel').disabled=done;$('upscale').disabled=r.job.status!=='completed'||r.provider==='longvideo';if(r.outputUrl){const link=document.createElement('a');link.href=r.outputUrl;link.target='_blank';link.rel='noreferrer';link.textContent='生成結果を開く';$('output').replaceChildren(link);}if(!done)setTimeout(poll,2500);}catch(e){$('status').textContent=e.message;}}await poll();}
$('provider').onchange=()=>{const p=$('provider').value;$('long').hidden=p!=='longvideo';$('short').hidden=p==='longvideo';$('plan').hidden=p!=='longvideo';$('frames').disabled=p==='krea';$('first').disabled=p==='krea';$('width').value=p==='krea'?1024:960;$('height').value=p==='krea'?1024:544;$('model').replaceChildren(new Option('一覧を更新してください',''));};$('provider').onchange();
$('start').onclick=run(async()=>{const result=await api('service',{provider:$('provider').value,action:'start'});show(result);if(result.ready===false){$('status').textContent=result.note;return;}await refresh();});
$('stop').onclick=run(async()=>show(await api('service',{provider:$('provider').value,action:'stop'})));
$('refresh').onclick=run(refresh);$('plan').onclick=run(async()=>show(await api('plan',args())));
$('provider').addEventListener('change',()=>{modelCatalog=[];updatePresets();$('loras').replaceChildren();$('latent').replaceChildren(new Option('使用しない','off'));});
$('lora-weight').oninput=()=>selectedWeights.clear();
$('submit').onclick=run(async()=>{const value=args();if(value.provider!=='krea')value.projectTitle=$('project-title').value.trim();value.loras=[...$('loras').selectedOptions].map(o=>({[value.provider==='krea'?'id':'path']:o.value,weight:selectedWeights.get(o.value)??Number($('lora-weight').value),enabled:true}));if(value.provider==='h3'&&value.model.includes('Hybrid-v2'))value.preset='quality';if(value.provider==='longvideo')await api('plan',value);$('status').textContent='GPU・RAMを使用する生成を開始します。';const r=await api('submit',value);await history();await follow(r.id);});
$('cancel').onclick=run(async()=>{show(await api('job',{id:current,action:'cancel'}));++serial;$('cancel').disabled=true;});
$('upscale').onclick=run(async()=>{const r=await api('upscale',{id:current});await history();await follow(r.id);});
$('library').onclick=run(async()=>{const r=await api('library',{family:$('provider').value==='krea'?'krea2':'h3',kind:'dataset',limit:100});$('datasets').replaceChildren();for(const item of r.items){const p=document.createElement('p');p.textContent=`${item.name} · ${item.category} · 画像${item.images} / 動画${item.videos} / 説明${item.captions}`;const path=document.createElement('small');path.textContent=item.path;p.append(document.createElement('br'),path);$('datasets').append(p);}});
run(history)();
