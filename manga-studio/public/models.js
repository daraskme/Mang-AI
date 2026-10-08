const $=id=>document.getElementById(id),params=new URLSearchParams(location.hash.slice(1)),base=`./api/${params.get('project')}/gallery/`,token=params.get('token'),session=params.get('session')||'';
const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
let catalog=[],selectedModel='',adapters=new Map(),serial=0,dirty=false,loadedProvider='';
const drafts=new Map();
window.mangAIHasUnsavedChanges=()=>dirty||[...drafts.values()].some(d=>d.dirty);
addEventListener('beforeunload',event=>{if(dirty||[...drafts.values()].some(d=>d.dirty)){event.preventDefault();event.returnValue='';}});
const api=async(path,body)=>{const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...body?{'Content-Type':'application/json'}:{}},body:body?JSON.stringify(body):undefined});const result=await response.json();if(!response.ok)throw Error(result.error);return result;};
const action=fn=>async()=>{try{await fn();}catch(error){$('status').textContent=error.message;}};
function selection(){const model=catalog.find(m=>m.kind==='model'&&m.id===selectedModel);$('selection').textContent=`選択：${model?.name||'モデル未選択'} · LoRA ${adapters.size}個${dirty?' · 未保存':''}`;}
function draw(){
  const query=$('search').value.toLowerCase(),kind=$('kind').value;$('cards').replaceChildren();
  for(const item of catalog.filter(m=>(kind==='all'||kind===m.kind)&&`${m.name} ${m.id}`.toLowerCase().includes(query))){
    const card=el('article');card.className='model-card';card.dataset.key=item.key;card.dataset.selected=String(item.kind==='model'?item.id===selectedModel:adapters.has(item.id));
    if(item.thumbnail){const img=el('img');img.alt=item.name;img.className='picture';img.loading='lazy';img.src=`${base}model-thumb/${item.key}?token=${encodeURIComponent(token)}&v=${item.thumbnail.revision}`;card.append(img);}else{const placeholder=el('div','サムネイル未登録');placeholder.className='picture';card.append(placeholder);}
    card.append(el('h2',item.name),el('small',item.kind==='model'?'モデル':'LoRA'));
    if(item.trigger)card.append(el('small',`トリガー：${Array.isArray(item.trigger)?item.trigger.join(', '):item.trigger}`));
    if(!item.available)card.append(el('small',item.reason||'現在は使用できません'));
    if(item.kind==='model'){
      const choose=el('button',item.id===selectedModel?'選択中':'このモデルを選ぶ');choose.disabled=!item.available;choose.onclick=()=>{selectedModel=item.id;dirty=true;draw();};card.append(choose);
    }else{
      const label=el('label','使用する'),check=el('input');check.type='checkbox';check.checked=adapters.has(item.id);check.disabled=!item.available;
      check.onchange=()=>{if(check.checked)adapters.set(item.id,{id:item.id,weight:0.8,enabled:true,role:'other'});else adapters.delete(item.id);dirty=true;draw();};label.append(check);card.append(label);
      if(adapters.has(item.id)){
        const fields=el('div');fields.className='fields';const weightLabel=el('label','強度'),weight=el('input');weight.type='number';weight.min=-4;weight.max=4;weight.step=0.1;weight.value=adapters.get(item.id).weight;weight.oninput=()=>{adapters.get(item.id).weight=Number(weight.value);dirty=true;selection();};weightLabel.append(weight);
        const roleLabel=el('label','用途'),role=el('select');for(const [value,name]of [['character','人物'],['style','Style'],['other','その他']])role.add(new Option(name,value));role.value=adapters.get(item.id).role||'other';role.onchange=()=>{adapters.get(item.id).role=role.value;dirty=true;selection();};roleLabel.append(role);fields.append(weightLabel,roleLabel);card.append(fields);
      }
    }
    const kindNames={reference:'参考画像',training:'学習データの参考',generated:'LoRAの生成例'};
    if(item.thumbnail)card.append(el('small',kindNames[item.thumbnail.kind||'reference']));
    const kindLabel=el('label','登録する画像の種類'),previewKind=el('select');
    for(const [value,name]of Object.entries(kindNames))previewKind.add(new Option(name,value));
    previewKind.value=item.thumbnail?.kind||'reference';kindLabel.append(previewKind);card.append(kindLabel);
    const upload=el('input');upload.type='file';upload.accept='image/png,image/jpeg,image/webp,image/avif';upload.hidden=true;
    const button=el('button',item.thumbnail?'画像を差し替える':'画像をアップロード');button.onclick=()=>upload.click();
    upload.onchange=action(async()=>{const file=upload.files[0];if(!file)return;if(file.size>6*1024*1024)throw Error('画像は6MB以下で選んでください');const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});item.thumbnail=await api('model-thumbnail',{key:item.key,dataUrl,kind:previewKind.value});draw();$('status').textContent='サムネイルを保存しました（全セッション共通）';});card.append(button,upload);
    if(item.kind==='lora'){
      const candidates=el('button','学習資料から選ぶ');
      candidates.onclick=action(async()=>{const result=await api('model-thumbnail',{key:item.key,action:'candidates'});$('status').textContent=result.note;
        if(!result.items.length){$('status').textContent+=' 利用できる候補がありません。';return;}
        const chooser=el('select');chooser.setAttribute('aria-label','参考画像の候補');for(const candidate of result.items)chooser.add(new Option(candidate.name,candidate.file));
        const use=el('button','この資料を設定');use.onclick=action(async()=>{item.thumbnail=await api('model-thumbnail',{key:item.key,file:chooser.value,kind:'training'});draw();$('status').textContent='学習データの参考サムネイルを保存しました';});candidates.replaceWith(chooser,use);
      });card.append(candidates);
    }
    if(item.thumbnail){const clear=el('button','サムネイルを解除');clear.onclick=action(async()=>{await api('model-thumbnail',{key:item.key,action:'clear'});item.thumbnail=null;draw();$('status').textContent='サムネイルを解除しました。元画像は保持されています';});card.append(clear);}
    $('cards').append(card);
  }selection();
}
async function load(refresh=false){
  if(loadedProvider)drafts.set(loadedProvider,{model:selectedModel,loras:structuredClone([...adapters.values()]),dirty});
  const ticket=++serial,provider=$('provider').value;$('status').textContent='一覧を読み込んでいます…';
  const result=await api('models?'+new URLSearchParams({provider,session,refresh:refresh?'1':'0'}));if(ticket!==serial)return;
  // Refresh and environment switches preserve local edits until explicitly saved.
  const draft=drafts.get(provider),chosen=draft?.dirty?draft:result.selection;
  catalog=result.items;selectedModel=chosen?.model||'';adapters=new Map((chosen?.loras||[]).map(l=>[l.id,l]));dirty=!!draft?.dirty;loadedProvider=provider;draw();$('status').textContent=result.note||`${catalog.filter(m=>m.kind==='model').length}モデル · ${catalog.filter(m=>m.kind==='lora').length} LoRA`;
}
$('provider').onchange=action(()=>load());$('kind').onchange=draw;$('search').oninput=draw;$('refresh').onclick=action(()=>load(true));
$('start').onclick=action(async()=>{$('status').textContent='生成環境を起動しています…';const ready=await api('model-service',{provider:$('provider').value});if(ready.ready===false){$('status').textContent=ready.note;return;}await load(true);});
$('save').onclick=action(async()=>{if(loadedProvider!==$('provider').value)throw Error('一覧の読み込み完了を待ってください');await api('model-selection',{session,provider:loadedProvider,model:selectedModel,loras:[...adapters.values()]});dirty=false;drafts.delete(loadedProvider);selection();$('status').textContent='このセッションの生成に使う組合せを保存しました';});
action(()=>load())();
