import {navigateMedia} from './navigation.js';
const $=id=>document.getElementById(id),hash=new URLSearchParams(location.hash.slice(1));
const project=hash.get('project'),token=hash.get('token'),base=`./api/${project}/gallery/`;
const session=hash.get('session');let scope=session?'session':'all';
document.body.classList.toggle('embedded',hash.get('embedded')==='1');
$('scope').hidden=!session;
let collections=[],group='projects',collection=null,items=[],total=0,selection=-1,loadSerial=0,previewSerial=0,catalogSerial=0,groupChosen=false,refreshing=false;
const labels={projects:'制作中の漫画',videos:'動画作品',sessions:'セッションのメディア',datasets:'データセット',outputs:'生成環境の履歴'};
const bytes=n=>n===undefined?'':n>1048576?`${(n/1048576).toFixed(1)} MB`:`${Math.ceil(n/1024)} KB`;
const fileURL=(id,thumb=false)=>`${base}${thumb?'thumb':'file'}/${id}?token=${encodeURIComponent(token)}`;
async function api(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...body?{'Content-Type':'application/json'}:{}},...body?{body:JSON.stringify(body)}:{}});const result=await r.json();if(!r.ok)throw Error(result.error);return result;}
function status(text){$('status').textContent=text;}
function action(fn){return async()=>{try{await fn();}catch(e){status(e.message);}};}
function drawCollections(){
  for(const b of $('groups').children){b.hidden=scope==='session'&&['datasets','outputs'].includes(b.dataset.group);b.setAttribute('aria-pressed',String(b.dataset.group===group));b.querySelector('span').textContent=collections.filter(c=>c.group===b.dataset.group).length;}
  $('group-name').textContent=labels[group];$('collections').replaceChildren();
  const query=$('collection-search').value.toLowerCase();
  for(const c of collections.filter(c=>c.group===group&&`${c.title} ${c.subtitle}`.toLowerCase().includes(query))){
    const b=document.createElement('button');b.className=c.id===collection?.id?'selected':'';b.dataset.id=c.id;b.textContent=c.title;
    const small=document.createElement('small');small.textContent=c.missing?`元画像なし · リンク切れ ${c.missing}件`:c.subtitle;b.append(small);b.onclick=action(()=>selectCollection(c));$('collections').append(b);
  }
}
async function selectCollection(c){collection=c;items=[];total=0;selection=-1;$('search').value='';$('title').textContent=c.title;$('summary').textContent=c.subtitle;drawCollections();await loadItems();}
async function loadItems(append=false,quiet=false){
  if(!collection)return;const ticket=++loadSerial;if(!quiet){status('メディアを読み込んでいます…');$('more').disabled=true;if(!append){$('grid').replaceChildren();$('empty').hidden=true;$('missing').hidden=true;}}
  const result=await api('items?'+new URLSearchParams({collection:collection.id,offset:append?items.length:0,query:$('search').value.trim()}));
  if(ticket!==loadSerial)return;
  if(quiet&&result.total===total&&JSON.stringify(result.items.map(i=>i.id))===JSON.stringify(items.map(i=>i.id)))return;
  if(!append){items=[];$('grid').replaceChildren();}
  total=result.total;items.push(...result.items);
  for(const item of result.items){
    const b=document.createElement('button');b.className='card';b.dataset.id=item.id;b.title=item.name;
    const thumb=document.createElement('span');thumb.className='thumbnail';const img=document.createElement('img');img.loading='lazy';img.decoding='async';img.alt=item.name;img.src=fileURL(item.id,true);
    img.onerror=()=>{img.remove();const fallback=document.createElement('span');fallback.className='fallback';fallback.textContent='プレビューを開く';thumb.prepend(fallback);};
    const badge=document.createElement('span');badge.className='badge';badge.textContent={image:'画像',video:'▶ 動画',page:'漫画ページ'}[item.kind];thumb.append(img,badge);
    const desc=document.createElement('span');desc.className='card-text';const name=document.createElement('strong');name.textContent=item.name;const meta=document.createElement('small');meta.textContent=item.kind==='page'?item.caption||'作画・文字を編集できます':`${bytes(item.bytes)} · ${new Date(item.mtime).toLocaleDateString('ja-JP')}`;desc.append(name,meta);b.append(thumb,desc);b.onclick=action(()=>preview(items.findIndex(x=>x.id===item.id)));$('grid').append(b);
  }
  $('empty').hidden=total>0;$('empty').textContent=result.missing?'元画像の保存場所が不明のため表示できません。学習済みLoRAは利用できます。':$('search').value?'一致するメディアがありません。':'このフォルダにはまだ画像・動画がありません。';
  $('missing').hidden=!result.missing;$('missing').textContent=`元画像を参照できないリンクが ${result.missing} 件あります。移行元に実体がなく、保存場所は不明です。`;
  $('more').hidden=items.length>=total;$('more').disabled=false;status(`${total.toLocaleString()}件中 ${items.length.toLocaleString()}件を表示`);
}
function clearViewer(){$('viewer').querySelector('video')?.pause();$('viewer').replaceChildren();}
async function preview(index){
  const item=items[index];if(!item)return;selection=index;const ticket=++previewSerial;clearViewer();$('preview-title').textContent=item.name;$('caption').textContent='読み込み中…';$('metadata').textContent='';$('path').textContent='';$('edit-status').textContent='';$('edit').disabled=true;
  $('previous').disabled=index===0;$('next').disabled=index>=items.length-1;$('position').textContent=`${index+1} / ${items.length}`;
  if(!$('preview').open)$('preview').showModal();
  const element=document.createElement(item.kind==='video'?'video':'img');element.src=fileURL(item.id);if(item.kind==='video'){element.controls=true;element.preload='metadata';element.playsInline=true;}else element.alt=item.name;$('viewer').append(element);$('original').href=fileURL(item.id);
  $('clean-export').hidden=item.kind==='page';$('clean-export').disabled=false;
  const detail=await api('detail/'+item.id);if(ticket!==previewSerial)return;
  $('caption').textContent=detail.caption||'キャプションはまだありません。';$('path').textContent=detail.file||'このセッションの漫画ページ';$('metadata').textContent=item.kind==='page'?`第${item.revision}版`:bytes(item.bytes);$('edit').textContent=item.kind==='page'?'漫画の編集を再開':'修正・モザイクで開く';$('edit').disabled=false;
}
async function refresh(quiet=false){
  const ticket=++catalogSerial,result=await api('collections'+(scope==='session'?'?'+new URLSearchParams({session}):''));if(ticket!==catalogSerial)return;collections=result.items;
  if(!groupChosen&&!collections.some(c=>c.group===group)&&collections.length)group=collections.find(c=>c.group==='sessions')?.group||collections[0].group;
  if(quiet&&collection&&collections.some(c=>c.id===collection.id)){drawCollections();await loadItems(false,true);return;}drawCollections();
  const previous=collections.find(c=>c.id===collection?.id);if(previous)await selectCollection(previous);else{const first=collections.find(c=>c.group===group);if(first)await selectCollection(first);else{++loadSerial;collection=null;items=[];$('grid').replaceChildren();$('title').textContent=labels[group];$('summary').textContent='';$('missing').hidden=true;$('more').hidden=true;$('empty').hidden=false;$('empty').textContent='まだ登録されていません。制作を始めるとここに表示されます。';status('');}}
}
for(const b of $('groups').children)b.onclick=action(async()=>{++loadSerial;groupChosen=true;group=b.dataset.group;collection=null;items=[];$('grid').replaceChildren();$('empty').hidden=true;await refresh();});
for(const b of $('scope').children)b.onclick=action(async()=>{scope=b.dataset.scope;for(const button of $('scope').children)button.setAttribute('aria-pressed',String(button.dataset.scope===scope));groupChosen=false;group='projects';collection=null;++loadSerial;await refresh();});
$('collection-search').oninput=drawCollections;$('refresh').onclick=action(refresh);$('more').onclick=action(()=>loadItems(true));$('search-form').onsubmit=e=>{e.preventDefault();action(()=>loadItems())();};
$('close').onclick=()=>$('preview').close();$('preview').onclose=()=>{++previewSerial;clearViewer();};$('previous').onclick=action(()=>preview(selection-1));$('next').onclick=action(()=>preview(selection+1));
$('edit').onclick=async()=>{const item=items[selection];if(!item)return;$('edit').disabled=true;try{const r=await api('open',{id:item.id,session});navigateMedia(r.url);$('preview').close();}catch(e){$('edit-status').textContent=e.message;$('edit').disabled=false;}};
$('use-in-chat').hidden=!session;$('use-in-chat').onclick=async()=>{const item=items[selection];if(!item)return;try{await api('reference',{session,id:item.id});$('edit-status').textContent='この会話の参照素材に設定しました。入力欄からA1へ指示してください。';}catch(e){$('edit-status').textContent=e.message;}};
$('clean-export').onclick=async()=>{
  const item=items[selection];if(!item||item.kind==='page')return;const button=$('clean-export');button.disabled=true;$('edit-status').textContent='投稿用コピーを作成しています…';
  try{
    const r=await fetch(base+'export-clean',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({id:item.id})});
    if(!r.ok)throw Error((await r.json()).error);
    const url=URL.createObjectURL(await r.blob()),link=document.createElement('a');link.href=url;link.download=r.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]||'mangai-post.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    $('edit-status').textContent='生成情報・EXIFを除いた投稿用コピーを保存しました。元ファイルは保持しています。';
  }catch(error){$('edit-status').textContent=error.message;}finally{button.disabled=false;}
};
if(!project||!token)status('Mang-AIのサイドバーにある「メディアギャラリー」から開いてください。');else action(refresh)();
setInterval(async()=>{if(refreshing||scope!=='session'||document.hidden||$('preview').open||items.length>48||$('search').value||$('collection-search').value)return;refreshing=true;try{await refresh(true);}catch{/* A manual refresh exposes connection errors without interrupting editing. */}finally{refreshing=false;}},6000);
