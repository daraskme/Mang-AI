const labels={pending:'未着手',optional:'任意',review:'確認・更新待ち',queued:'順番待ち',running:'処理中',completed:'完了',failed:'失敗',interrupted:'中断',canceled:'中止',cancelled:'中止',superseded:'脚本変更により中断'};
const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
function duration(job){const start=Date.parse(job.startedAt),end=job.finishedAt?Date.parse(job.finishedAt):Date.now();if(!Number.isFinite(start)||!Number.isFinite(end))return '';const sec=Math.max(0,Math.floor((end-start)/1000));return `${Math.floor(sec/60)}分${sec%60}秒`+(job.finishedAt?'':'経過');}

import {navigateMedia} from './navigation.js';

export function mountProgress(host,{fetchSnapshot,onOpen}) {
  host.classList.add('production-progress');
  const toolbar=el('div',undefined,'progress-toolbar'),heading=el('strong','制作の進捗'),connection=el('span','接続中…','progress-connection'),cards=el('div',undefined,'progress-cards');
  const gpu=el('section',undefined,'progress-card');gpu.hidden=true;gpu.setAttribute('aria-label','GPUとメモリの使用状況');
  connection.setAttribute('role','status');toolbar.append(heading,connection);host.append(toolbar,gpu,cards);
  let stopped=false,busy=false,timer;
  async function update(){
    if(stopped||busy)return;busy=true;
    try {
      const data=await fetchSnapshot();if(stopped)return;
      gpu.hidden=!data.gpu?.enabled;
      if(data.gpu?.enabled){
        const info=data.gpu,free=info.resources,active=(info.requests||[]).filter(r=>['running','queued','waiting_memory'].includes(r.state));
        gpu.replaceChildren(el('h3','GPU・メモリ'),el('p',`司令塔：${typeof info.resident==='string'?info.resident:info.resident?.model||'A1'}${info.resident?.status?' · '+info.resident.status:''}`));
        if(free)gpu.append(el('p',`空きRAM ${free.ramAvailableGiB??'?'} GiB · 空きVRAM ${free.vramFreeGiB??'?'} / ${free.vramTotalGiB??'?'} GiB`));
        if(info.error||free?.error)gpu.append(el('p',info.error||free.error,'progress-error'));
        if(!active.length)gpu.append(el('p','大規模処理は待機中です。'));
        for(const task of active)gpu.append(el('p',`${task.label} · ${{running:'実行中',queued:'順番待ち',waiting_memory:'メモリ待ち'}[task.state]} · ${task.reason}`));
      }
      const expanded=new Set([...cards.querySelectorAll('details[open]')].map(d=>d.dataset.project));
      const nodes=data.items.map(item=>{
        const card=el('article',undefined,'progress-card');card.dataset.project=item.id;
        const top=el('div',undefined,'progress-card-header');top.append(el('h3',item.title));
        if(onOpen){const open=el('button','編集を開く');open.onclick=async()=>{try{await onOpen(item.id);}catch(e){connection.textContent=e.message;connection.dataset.error='true';}};top.append(open);}card.append(top);
        const stages=el('div',undefined,'progress-stages');
        for(const stage of item.stages){const cell=el('div',undefined,'progress-stage');cell.dataset.state=stage.state;cell.dataset.stage=stage.id;cell.append(el('strong',stage.label),el('span',labels[stage.state]||stage.state,'progress-badge'),el('small',stage.detail));if(stage.error)cell.append(el('p',stage.error,'progress-error'));stages.append(cell);}card.append(stages);
        const history=el('details');history.dataset.project=item.id;history.open=item.active||expanded.has(item.id);history.append(el('summary','処理の詳細・履歴'));
        for(const job of item.jobs){const line=el('div',undefined,'progress-job');line.append(el('div',`${job.pageId} · ${labels[job.state]||job.state} · ${job.completed}/${job.total}コマ${job.model?' · '+job.model:''}`));
          const meter=el('progress');meter.max=Math.max(1,job.total);meter.value=job.completed;meter.setAttribute('aria-label','生成済みコマ数');line.append(meter);
          if(['running','queued'].includes(job.state)&&job.progress){line.append(el('div',`${job.progress.panelId} · ${job.progress.message||job.progress.stage||'処理中'}${job.progress.ratio===null?'':` · ${Math.round(job.progress.ratio*100)}%`}`));}
          line.append(el('small',duration(job)));if(job.error)line.append(el('p',job.error,'progress-error'));history.append(line);
        }
        for(const job of item.edits){const line=el('div',undefined,'progress-job');line.append(el('div',`${job.mode==='inpaint'?'IOPaint修正':job.mode==='mosaic'?'モザイク':'範囲検出'} · ${labels[job.state]||job.state} · ${job.message||''}`),el('small',duration(job)));if(job.error)line.append(el('p',job.error,'progress-error'));history.append(line);}card.append(history);return card;
      });
      cards.replaceChildren(...(nodes.length?nodes:[el('p','まだ制作中の漫画はありません。エージェントに漫画の作成を依頼すると表示されます。','progress-empty')]));
      connection.dataset.error='false';connection.textContent=`自動更新 · ${new Date().toLocaleTimeString('ja-JP')}`;
    }catch(error){connection.dataset.error='true';connection.textContent=`接続できません。表示は前回の状態です · ${error.message}`;}
    finally{busy=false;if(!stopped)timer=setTimeout(update,2000);}
  }
  update();const stop=()=>{stopped=true;clearTimeout(timer);};window.addEventListener('pagehide',stop,{once:true});return {refresh:update,stop};
}

if(location.pathname.endsWith('/progress.html')) {
  const params=new URLSearchParams(location.hash.slice(1)),id=params.get('project'),token=params.get('token');
  const base=`./api/${id}/gallery/`,headers={Authorization:`Bearer ${token}`};
  document.getElementById('galleryLink').href='./gallery.html'+location.hash;
  document.getElementById('galleryLink').onclick=e=>{e.preventDefault();navigateMedia(e.currentTarget.href);};
  const request=async(action,body)=>{const r=await fetch(base+action,{method:body?'POST':'GET',headers:{...headers,...body?{'Content-Type':'application/json'}:{}},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});const result=await r.json();if(!r.ok)throw Error(result.error);return result;};
  mountProgress(document.getElementById('productionProgress'),{fetchSnapshot:()=>request('progress'+(params.get('session')?'?'+new URLSearchParams({session:params.get('session')}):'')),onOpen:async projectId=>{navigateMedia((await request('progress-open',{projectId})).url);}});
}
