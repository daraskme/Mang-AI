import {navigateMedia} from '/navigation.js';
const $=id=>document.getElementById(id),hash=new URLSearchParams(location.hash.slice(1));
const project=hash.get('project'),token=hash.get('token'),base=`/api/${project}/gallery/`;
const session=hash.get('session');let scope=session?'session':'all';
document.body.classList.toggle('embedded',hash.get('embedded')==='1');
$('scope').hidden=!session;
let collections=[],group='projects',collection=null,items=[],total=0,selection=-1,loadSerial=0,previewSerial=0,catalogSerial=0;
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
async function loadItems(append=false){
  if(!collection)return;const ticket=++loadSerial;status('メディアを読み込んでいます…');$('more').disabled=true;if(!append){$('grid').replaceChildren();$('empty').hidden=true;$('missing').hidden=true;}
  const result=await api('items?'+new URLSearchParams({collection:collection.id,offset:append?items.length:0,query:$('search').value.trim()}));
  if(ticket!==loadSerial)return;
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
  const detail=await api('detail/'+item.id);if(ticket!==previewSerial)return;
  $('caption').textContent=detail.caption||'キャプションはまだありません。';$('path').textContent=detail.file||'このセッションの漫画ページ';$('metadata').textContent=item.kind==='page'?`第${item.revision}版`:bytes(item.bytes);$('edit').textContent=item.kind==='page'?'漫画の編集を再開':'修正・モザイクで開く';$('edit').disabled=false;
}
async function refresh(){
  const ticket=++catalogSerial,result=await api('collections'+(scope==='session'?'?'+new URLSearchParams({session}):''));if(ticket!==catalogSerial)return;collections=result.items;drawCollections();
  const previous=collections.find(c=>c.id===collection?.id);if(previous)await selectCollection(previous);else{const first=collections.find(c=>c.group===group);if(first)await selectCollection(first);else{++loadSerial;collection=null;items=[];$('grid').replaceChildren();$('title').textContent=labels[group];$('summary').textContent='';$('missing').hidden=true;$('more').hidden=true;$('empty').hidden=false;$('empty').textContent='まだ登録されていません。制作を始めるとここに表示されます。';status('');}}
}
for(const b of $('groups').children)b.onclick=action(async()=>{++loadSerial;group=b.dataset.group;collection=null;items=[];$('grid').replaceChildren();$('empty').hidden=true;await refresh();});
for(const b of $('scope').children)b.onclick=action(async()=>{scope=b.dataset.scope;for(const button of $('scope').children)button.setAttribute('aria-pressed',String(button.dataset.scope===scope));group='projects';collection=null;++loadSerial;await refresh();});
$('collection-search').oninput=drawCollections;$('refresh').onclick=action(refresh);$('more').onclick=action(()=>loadItems(true));$('search-form').onsubmit=e=>{e.preventDefault();action(()=>loadItems())();};
$('close').onclick=()=>$('preview').close();$('preview').onclose=()=>{++previewSerial;clearViewer();};$('previous').onclick=action(()=>preview(selection-1));$('next').onclick=action(()=>preview(selection+1));
$('edit').onclick=async()=>{const item=items[selection];if(!item)return;$('edit').disabled=true;try{const r=await api('open',{id:item.id});navigateMedia(r.url);$('preview').close();}catch(e){$('edit-status').textContent=e.message;$('edit').disabled=false;}};
if(!project||!token)status('Mang-AIのサイドバーにある「メディアギャラリー」から開いてください。');else action(refresh)();
