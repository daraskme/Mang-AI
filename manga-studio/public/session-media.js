import "./frame-theme.js";
import {mountProgress} from './progress.js';
const $=id=>document.getElementById(id),p=new URLSearchParams(location.hash.slice(1)),session=p.get('session'),token=p.get('token'),base=`./api/${p.get('project')}/gallery/`,host=p.get('host');
document.documentElement.dataset.theme=p.get('theme')==='light'?'light':'dark';
let signature='',busy=false,reference=null;
async function api(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...body?{'Content-Type':'application/json'}:{}},...body?{body:JSON.stringify(body)}:{},signal:AbortSignal.timeout(10000)});const result=await r.json();if(!r.ok)throw Error(result.error);return result;}
function notify(data){if(host&&parent!==window)parent.postMessage({session,...data},host);}
function resize(){notify({type:'mang-ai:strip-size',height:Math.ceil(document.body.getBoundingClientRect().height)+4});}
$('open').onclick=()=>notify({type:'mang-ai:open-media',view:'gallery'});
$('clear').onclick=async()=>{try{await api('reference',{session,id:null});signature='';await refresh();}catch(e){$('state').textContent=e.message;}};
$('copy').onclick=async()=>{if(!reference)return;const name={image:'画像',video:'動画',page:'漫画'}[reference.kind]||'素材',text=`[${name} ${reference.referenceId}]`;try{await navigator.clipboard.writeText(text);$('state').textContent='参照名をコピーしました。指示文に貼り付けられます';}catch{$('state').textContent=text;}resize();};
async function refresh(){
  if(busy||document.hidden||!session)return;busy=true;
  try{
    const value=await api('session-media?'+new URLSearchParams({session}));if(value.session!==session)return;const next=JSON.stringify(value);if(next===signature)return;signature=next;reference=value.reference;
    document.body.classList.toggle('empty-media',!value.total&&!value.reference);$('count').textContent=value.total?`(${value.total})`:'';$('state').textContent='';$('recent').replaceChildren();
    for(const item of value.items){const b=document.createElement('button'),img=document.createElement('img');b.title=item.name+'を会話で使う';b.setAttribute('aria-label',b.title);img.src=base+'thumb/'+item.id+'?token='+encodeURIComponent(token);img.alt=item.name;img.loading='lazy';b.append(img);if(item.kind==='video'){const tag=document.createElement('small');tag.textContent='▶';b.append(tag);}b.onclick=async()=>{try{await api('reference',{session,id:item.id});signature='';await refresh();}catch(e){$('state').textContent=e.message;}};$('recent').append(b);}
    $('reference').hidden=!value.reference;$('reference-label').textContent=value.reference?'会話の参照素材: '+value.reference.name:'';resize();
  }catch(e){$('state').textContent='メディアの再接続を待っています';resize();}finally{busy=false;}
}
if(p.get('overview')==='1'&&session){document.body.classList.add('overview');$('inline-progress').hidden=false;mountProgress($('inline-progress'),{compact:true,fetchSnapshot:()=>api('progress?'+new URLSearchParams({session}))});}
new ResizeObserver(resize).observe(document.body);document.addEventListener('visibilitychange',refresh);setInterval(refresh,4000);refresh();
