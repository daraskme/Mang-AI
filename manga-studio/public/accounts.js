const $=id=>document.getElementById(id),params=new URLSearchParams(location.hash.slice(1)),session=params.get('session'),view=params.get('view')||'settings';
let token=params.get('token'),renewingToken=null;
const host=params.get('host')||location.origin;
window.addEventListener('hashchange',()=>location.reload());
document.body.classList.toggle('light',params.get('theme')==='light');document.body.classList.toggle('compact',view==='quota');document.body.classList.toggle('session',view==='session');
$('settings').hidden=view!=='settings';$('session-card').hidden=!['session','agent'].includes(view)||!session;$('agent-compose').hidden=view!=='agent'||!session;$('jobs').hidden=view!=='agent'||!session;$('open-agent').hidden=view!=='session';
let state={accounts:[]},signature='',selectionDirty=false,busy=false,loaded=false;
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const button=(text,run)=>{const b=el('button',text);b.type='button';b.onclick=()=>action(run,b);return b;};
async function renewToken(){
  if(renewingToken)return renewingToken;
  if(!location.pathname.startsWith('/mang-ai/'))return false;
  renewingToken=(async()=>{
    // Only the authenticated DSH page on this same origin can issue a fresh
    // capability. Do not weaken the account API or fetch tokens cross-origin.
    const response=await fetch(new URL('/',location.origin),{credentials:'same-origin',cache:'no-store',redirect:'error'});
    if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return false;
    const html=await response.text(),match=html.match(/__MANGAI_ACCOUNTS__["\]]*\s*(?:=|:)\s*("(?:\\.|[^"\\])*")/);
    if(!match)return false;
    const fresh=new URL(JSON.parse(match[1]));
    if(fresh.pathname!=='/mang-ai/accounts.html')return false;
    const next=new URLSearchParams(fresh.hash.slice(1)).get('token');
    if(!/^[a-f0-9]{64}$/.test(next||'')||next===token)return false;
    token=next;params.set('token',token);
    history.replaceState(null,'',location.pathname+location.search+'#'+params.toString());
    return true;
  })();
  try{return await renewingToken;}catch{return false;}finally{renewingToken=null;}
}
async function api(action,body,retried=false){
  const r=await fetch(new URL('api/accounts/'+action,location.href),{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Authorization:'Bearer '+token,...body===undefined?{}:{'Content-Type':'application/json'}},...body===undefined?{}:{body:JSON.stringify(body)}});
  if(r.status===401){
    if(!retried&&await renewToken())return api(action,body,true);
    throw Error('画面の認証が切れているため登録情報を読み込めません。「Mang-AIを開く」から接続し直してください。');
  }
  if(!r.headers.get('content-type')?.includes('application/json'))throw Error('登録情報を読み込めません。Mang-AIへの接続を確認してください。');
  const data=await r.json();if(!r.ok)throw Error(data.error||'通信に失敗しました');return data;
}
function resize(){if(parent!==window)parent.postMessage({type:'mang-ai:accounts-size',session,height:document.documentElement.scrollHeight,view},host);}
async function action(fn,b){if(b)b.disabled=true;$('notice').textContent='';try{await fn();await update();}catch(e){$('notice').textContent=e.message;}finally{if(b)b.disabled=false;resize();}}
function humanWindow(w){if(w.label==='日次'||w.label==='週次')return w.label;if(!w.minutes)return w.label;return w.label+' · '+(w.minutes>=1440?w.minutes/1440+'日':w.minutes>=60?w.minutes/60+'時間':w.minutes+'分');}
function renderQuota(){
  const root=$('quota');root.replaceChildren();
  const selected=state.accounts.find(a=>a.id===state.selection?.accountId);
  if(!session){root.append(el('p','セッションを開くと担当アカウントの残量を表示します','muted'));return;}
  if(!selected){root.append(el('p','Codex / Devin 未選択','muted'));return;}
  root.append(el('h2',`${selected.provider==='codex'?'Codex':'Devin'} · ${selected.label}`));
  if(!selected.quota?.windows?.length)root.append(el('p',selected.error||'残り使用量・リセット：未取得','muted'));
  for(const w of selected.quota?.windows||[]){const row=el('div',undefined,'quota-window');row.append(el('span',humanWindow(w)),el('strong',w.remainingPercent===null?'未取得':`残り ${Math.round(w.remainingPercent)}%`));
    if(w.remainingPercent!==null){const p=el('progress');p.max=100;p.value=w.remainingPercent;p.setAttribute('aria-label',humanWindow(w)+'の残り使用量');row.append(p);}
    const reset=w.resetsAt?new Date(w.resetsAt*1000):null;row.append(el('div',reset?`リセット ${new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(reset)}${reset.getTime()<=Date.now()?'（再取得待ち）':''}`:'リセット時刻：未取得','muted'));root.append(row);
  }
  if(selected.quota?.updatedAt)root.append(el('p',`更新 ${new Date(selected.quota.updatedAt).toLocaleTimeString('ja-JP')}${Date.now()-selected.quota.updatedAt>120000?' · 古い取得値':''}`,'muted'));
  if(selected.error&&selected.quota?.windows?.length)root.append(el('p',selected.error+'（前回の値）','error'));
}
function populateModels(accountId,model){const select=$('session-model');select.replaceChildren();const account=state.accounts.find(a=>a.id===accountId);for(const m of account?.models||[]){const o=el('option',m.name);o.value=m.id;select.append(o);}if(model)select.value=model;}
function renderSelection(){if(!['session','agent'].includes(view)||selectionDirty)return;const select=$('session-account');select.replaceChildren();const none=el('option','担当を選択');none.value='';select.append(none);for(const a of state.accounts){const o=el('option',`${a.provider} · ${a.label}`);o.value=a.id;select.append(o);}select.value=state.selection?.accountId||'';populateModels(select.value,state.selection?.model);$('selection-note').textContent=state.jobs?.find(j=>j.status==='approval')?'担当からの確認があります。「開く」で回答してください':state.selection?'このセッションで保存済み':'「プラグイン」の「AIアカウント」から追加できます';}
function loginBox(account){const box=el('div',undefined,'login'),login=account.login;
  const link=el('a','公式ログインを開く');link.href=login.url;link.target='_blank';link.rel='noopener noreferrer';box.append(link);
  if(login.code)box.append(el('p','ログインページに入力するコード'),el('code',login.code));
  if(login.kind==='code'){box.append(el('p','ログイン後に表示されたコードをここへ入力してください'));const input=el('input');input.type='password';input.autocomplete='off';input.placeholder='Devinのログインコード';input.setAttribute('aria-label','Devinのログインコード');box.append(input,button('コードを送信',async()=>{const code=input.value;input.value='';await api('login-code',{id:account.id,code});}));}
  if(account.provider==='codex'&&login.kind==='device')box.append(el('p','デバイスコード認証が無効の場合はChatGPTのセキュリティ設定で有効にしてください。'));
  box.append(button('ログインを中止',()=>api('cancel-login',{id:account.id})));return box;
}
function renderAccounts(){if(view!=='settings')return;const value=JSON.stringify(state.accounts.map(a=>({id:a.id,label:a.label,authenticated:a.authenticated,checking:a.checking,email:a.email,plan:a.plan,error:a.error,loginError:a.loginError,login:a.login,models:a.models?.length})));if(value!==signature){signature=value;$('accounts').replaceChildren();for(const a of state.accounts){const card=el('section',undefined,'account');card.append(el('h2',`${a.provider==='codex'?'Codex':'Devin'} · ${a.label}`),el('p',a.checking?'保存済みのログインを確認中…':a.authenticated?[a.email,a.plan,'ログイン済み'].filter(Boolean).join(' · '):'未ログイン / 未確認'));
    const row=el('div',undefined,'row');if(!a.authenticated&&!a.checking){row.append(button('ログイン',()=>api('login',{id:a.id,mode:'device'})));if(a.provider==='codex')row.append(button('このPCのブラウザでログイン',()=>api('login',{id:a.id,mode:'browser'})));}
    row.append(button('状態・モデル・残量を更新',()=>api('refresh',{id:a.id})));if(a.authenticated)row.append(button('ログアウト',()=>{if(confirm('このアカウントからログアウトしますか？'))return api('logout',{id:a.id});}));
    card.append(row);if(a.login)card.append(loginBox(a));if(a.error||a.loginError)card.append(el('p',a.error||a.loginError,'error'));if(a.models?.length)card.append(el('p',`${a.models.length}モデルを選択できます`,'muted'));$('accounts').append(card);
  }}$('empty-accounts').hidden=state.accounts.length>0;$('deepseek-state').textContent=state.deepseek?.configured?'APIキー登録済み':'APIキー未登録';$('deepseek-key').disabled=!state.deepseek?.writable;
}
const jobNodes=new Map();
function renderJobs(){if(view!=='agent')return;for(const job of state.jobs||[]){let parts=jobNodes.get(job.id);if(!parts){const node=el('section'),status=el('p'),output=el('pre'),approval=el('div');node.append(el('h2',`${job.accountLabel} · ${job.model}`),el('p',job.prompt),status,output,approval,button('中止',()=>api('job-cancel',{session,jobId:job.id})));$('jobs').prepend(node);parts={node,status,output,approval};jobNodes.set(job.id,parts);}parts.status.textContent=job.phase;parts.output.textContent=job.output;const id=job.approval?.id;if(id===parts.approvalId)continue;parts.approvalId=id;parts.approval.replaceChildren();if(!id)continue;
    const a=job.approval,details=el('details'),summary=el('summary','担当からの確認内容'),pre=el('pre',JSON.stringify(a.details,null,2));details.open=true;details.append(summary,pre);parts.approval.append(details);
    const respond=body=>api('job-respond',{session,jobId:job.id,approvalId:id,...body});
    if(a.method==='item/tool/requestUserInput'){const inputs=[];for(const q of a.details.questions||[]){const label=el('label',q.question),input=el('textarea');input.setAttribute('aria-label',q.question);label.append(input);parts.approval.append(label);inputs.push([q.id,input]);}parts.approval.append(button('回答を送信',()=>respond({answers:Object.fromEntries(inputs.map(([k,i])=>[k,i.value]))})));}
    else parts.approval.append(button('今回だけ許可',()=>respond({allow:true})),button('拒否',()=>respond({allow:false})));
  }}
async function update(){if(busy)return;busy=true;try{state=await api('state'+(session?'?session='+encodeURIComponent(session):''));loaded=true;$('connection').hidden=true;$('settings').disabled=false;renderQuota();renderSelection();renderAccounts();renderJobs();}catch(e){$('connection').hidden=false;$('connection-message').textContent=(loaded?'前回取得した情報を表示しています。':'登録情報を読み込めていません。再登録はせず、接続を確認してください。')+' '+e.message;$('retry-load').hidden=false;$('reopen-app').hidden=!location.pathname.startsWith('/mang-ai/');}finally{busy=false;resize();}}
$('retry-load').onclick=()=>update();
$('add-account').onsubmit=e=>{e.preventDefault();action(async()=>{await api('add',{provider:$('provider').value,label:$('account-label').value});$('account-label').value='';});};
$('deepseek-form').onsubmit=e=>{e.preventDefault();action(async()=>{const key=$('deepseek-key').value;$('deepseek-key').value='';await api('deepseek-key',{key});});};
$('deepseek-remove').onclick=()=>action(()=>confirm('保存したDeepSeek APIキーを解除しますか？')?api('deepseek-key',{key:null}):null);
$('session-account').onchange=()=>{selectionDirty=true;const id=$('session-account').value;populateModels(id);if(id)action(async()=>{await api('refresh',{id});state=await api('state?session='+encodeURIComponent(session));populateModels(id);});};
$('session-model').onchange=()=>{selectionDirty=true;};
$('save-selection').onclick=()=>action(async()=>{await api('select',{session,accountId:$('session-account').value||null,model:$('session-model').value});selectionDirty=false;parent.postMessage({type:'mang-ai:account-selected',session},host);});
new ResizeObserver(resize).observe(document.body);await update();setInterval(()=>{if(!document.hidden)update();},3000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
const draftKey='mang-ai-agent-draft:'+session;
if(view==='agent'){try{$('agent-prompt').value=sessionStorage.getItem(draftKey)||'';}catch{}}
$('agent-prompt').oninput=()=>{try{sessionStorage.setItem(draftKey,$('agent-prompt').value);}catch{}};
$('agent-form').onsubmit=e=>{e.preventDefault();action(async()=>{await api('job-start',{session,prompt:$('agent-prompt').value});$('agent-prompt').value='';try{sessionStorage.removeItem(draftKey);}catch{}});};
$('open-agent').onclick=()=>parent.postMessage({type:'mang-ai:open-agent',session},host);
