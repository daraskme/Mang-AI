import "./frame-theme.js";
import {mountProgress} from './progress.js';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.hash.slice(1));
window.addEventListener('hashchange',()=>location.reload());
const base=`./api/${params.get('project')}/gallery/`,session=params.get('session')||'';
const frames={gallery:$('gallery-frame'),generate:$('generate-frame'),models:$('models-frame'),editor:$('editor-frame')};
const request=async(action,body)=>{const r=await fetch(base+action,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${params.get('token')}`,...body?{'Content-Type':'application/json'}:{}},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});const result=await r.json();if(!r.ok)throw Error(result.error);return result;};
let current='gallery';
const embedded=value=>{const url=new URL(value,location.href),p=new URLSearchParams(url.hash.slice(1));p.set('embedded','1');url.hash=p.toString();return url.href;};
function screen(name){const p=new URLSearchParams(params);p.delete('view');p.delete('accountToken');return `./${name}.html#${p}`;}
function show(view){
  // Legacy progress links focus the persistent bars without replacing the current view.
  if(view==='progress'){$('workspace-progress').focus();return;}
  if(!frames[view])return;
  current=view;document.body.dataset.activeView=view;for(const [key,frame]of Object.entries(frames))frame.hidden=key!==view;
  for(const button of document.querySelectorAll('[data-view]')){const selected=button.dataset.view===view;button.setAttribute('aria-pressed',String(selected));button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}
  $('editor-empty').hidden=view!=='editor'||!!frames.editor.getAttribute('src');
  // Keep visited frames mounted so unsaved text, masks and gallery filters survive.
  if(!['editor','generate'].includes(view)&&!frames[view].getAttribute('src'))frames[view].src=embedded(screen(view));
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
  try{const view=button.dataset.view;if(view==='editor'&&!frames.editor.getAttribute('src')){const c=await context();if(c.editorUrl)return await openEditor(c.editorUrl);}if(view==='generate'&&!frames.generate.getAttribute('src')){const c=await context();if(!c.generationUrl){$('workspace-status').textContent='生成するセッションを先に開いてください';return;}frames.generate.src=embedded(c.generationUrl);}show(view);}catch(e){$('workspace-status').textContent=e.message;}
};
document.querySelector('[role=tablist]').addEventListener('keydown',event=>{const tabs=[...document.querySelectorAll('[data-view]')],index=tabs.indexOf(document.activeElement);if(index<0||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const target=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[target].focus();tabs[target].click();});
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||!Object.values(frames).some(f=>event.source===f.contentWindow)||event.data?.type!=='mang-ai:navigate')return;
  try{
    const url=new URL(event.data.url);if(url.origin!==location.origin)return;
    if(url.pathname.endsWith('/gallery.html'))show('gallery');
    else if(url.pathname.endsWith('/generate.html')){if(!frames.generate.getAttribute('src'))frames.generate.src=embedded(url.href);show('generate');}
    else if(url.pathname.endsWith('/progress.html'))show('progress');
    else if((url.pathname===new URL('./',location.href).pathname||url.pathname.endsWith('/media.html')))openEditor(url.href).catch(e=>$('workspace-status').textContent=e.message);
  }catch{/* Ignore unrelated frames and malformed messages. */}
});
// The outer dock may request the progress tab without reloading this workspace.
const hostOrigin=params.get('host')||(document.referrer?new URL(document.referrer).origin:null);
window.addEventListener('message',event=>{if(parent!==window&&event.source===parent&&event.origin===hostOrigin&&event.data?.type==='mang-ai:view'&&['gallery','progress'].includes(event.data.view))show(event.data.view);});
show(current);context().catch(e=>$('workspace-status').textContent=e.message);
mountProgress($('workspace-progress'),{compact:true,fetchSnapshot:()=>request('progress'+(session?'?'+new URLSearchParams({session}):'')),onOpen:async projectId=>openEditor((await request('progress-open',{projectId})).url)});
if(params.get('view')==='progress')show('progress');
if(params.get('accountToken')){
  const quota=$('workspace-quota'),url=new URL('./accounts.html',location.href);url.hash=new URLSearchParams({token:params.get('accountToken'),session,view:'quota',theme:params.get('theme')||'dark',host:location.origin}).toString();quota.src=url.href;quota.hidden=false;
  window.addEventListener('message',event=>{if(event.source===quota.contentWindow&&event.origin===location.origin&&event.data?.type==='mang-ai:accounts-size')quota.style.height=Math.max(28,Math.min(260,event.data.height||40))+'px';});
}
