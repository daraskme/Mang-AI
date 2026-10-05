const $=id=>document.getElementById(id),params=new URLSearchParams(location.hash.slice(1));
window.addEventListener('hashchange',()=>location.reload());
const base=`/api/${params.get('project')}/gallery/`,session=params.get('session')||'';
const frames={gallery:$('gallery-frame'),progress:$('progress-frame'),editor:$('editor-frame')};
let current=params.get('view')==='progress'?'progress':'gallery';
const embedded=value=>{const url=new URL(value,location.href),p=new URLSearchParams(url.hash.slice(1));p.set('embedded','1');url.hash=p.toString();return url.href;};
function screen(name){const p=new URLSearchParams(params);p.delete('view');return `/${name}.html#${p}`;}
function show(view){
  current=view;for(const [key,frame]of Object.entries(frames))frame.hidden=key!==view;
  for(const button of document.querySelectorAll('[data-view]'))button.setAttribute('aria-pressed',String(button.dataset.view===view));
  $('editor-empty').hidden=view!=='editor'||!!frames.editor.getAttribute('src');
  // Keep visited frames mounted so unsaved text, masks and gallery filters survive.
  if(view!=='editor'&&!frames[view].getAttribute('src'))frames[view].src=embedded(screen(view));
}
async function context(){
  const r=await fetch(base+'workspace?'+new URLSearchParams({session}),{headers:{Authorization:`Bearer ${params.get('token')}`},signal:AbortSignal.timeout(10000)});
  const result=await r.json();if(!r.ok)throw Error(result.error);$('workspace-title').textContent=result.title;return result;
}
async function openEditor(value){
  const target=embedded(value),frame=frames.editor,existing=frame.contentWindow;
  if(frame.getAttribute('src')===target){show('editor');return;}
  if(existing?.mangAIHasUnsavedChanges?.()){
    show('editor');$('workspace-status').textContent='別の画像・ページを開く前に、編集中の文字やマスクを保存・処理してください。';return;
  }
  // Assigning another fragment alone would leave the old editor's module state.
  if(frame.getAttribute('src')){const replacement=frame.cloneNode();replacement.src=target;frame.replaceWith(replacement);frames.editor=replacement;}else frame.src=target;
  $('workspace-status').textContent='';show('editor');
}
for(const button of document.querySelectorAll('[data-view]'))button.onclick=async()=>{
  try{const view=button.dataset.view;if(view==='editor'&&!frames.editor.getAttribute('src')){const c=await context();if(c.editorUrl)return await openEditor(c.editorUrl);}show(view);}catch(e){$('workspace-status').textContent=e.message;}
};
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||!Object.values(frames).some(f=>event.source===f.contentWindow)||event.data?.type!=='mang-ai:navigate')return;
  try{
    const url=new URL(event.data.url);if(url.origin!==location.origin)return;
    if(url.pathname==='/gallery.html')show('gallery');
    else if(url.pathname==='/progress.html')show('progress');
    else if(['/', '/media.html'].includes(url.pathname))openEditor(url.href).catch(e=>$('workspace-status').textContent=e.message);
  }catch{/* Ignore unrelated frames and malformed messages. */}
});
// The outer dock may request the progress tab without reloading this workspace.
const hostOrigin=params.get('host')||(document.referrer?new URL(document.referrer).origin:null);
window.addEventListener('message',event=>{if(parent!==window&&event.source===parent&&event.origin===hostOrigin&&event.data?.type==='mang-ai:view'&&['gallery','progress'].includes(event.data.view))show(event.data.view);});
show(current);context().catch(e=>$('workspace-status').textContent=e.message);
