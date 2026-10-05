import {randomUUID} from 'node:crypto';
import {letteringWarnings} from './render.js';

const active=state=>['running','queued'].includes(state);
const failure=state=>['failed','interrupted','canceled','cancelled','superseded'].includes(state);

/** Persisted production state; reading this never starts a model or worker. */
export class WorkflowProgress {
  constructor(service) {
    this.service=service;this.db=service.store.db;
    this.db.exec('CREATE TABLE IF NOT EXISTS workflow_progress (project TEXT NOT NULL, phase TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(project,phase))');
    for(const row of this.db.prepare('SELECT * FROM workflow_progress').all()) {
      const value=JSON.parse(row.body);
      if(active(value.state))this.save(row.project,row.phase,{...value,state:'interrupted',error:'アプリが終了しました。保存済みデータから再開できます。',finishedAt:new Date().toISOString()});
    }
  }
  save(project,phase,value) {this.db.prepare('INSERT OR REPLACE INTO workflow_progress VALUES (?,?,?)').run(project,phase,JSON.stringify(value));}
  async track(project,phase,fn,revision) {
    const task={id:randomUUID(),state:'running',startedAt:new Date().toISOString()};this.save(project,phase,task);
    const finish=value=>{
      const row=this.db.prepare('SELECT body FROM workflow_progress WHERE project=? AND phase=?').get(project,phase);
      if(row&&JSON.parse(row.body).id===task.id)this.save(project,phase,{...task,...value,finishedAt:new Date().toISOString()});
    };
    try {const result=await fn();finish({state:'completed',revision:revision??this.service.store.get(project).revision});return result;}
    catch(error){finish({state:'failed',error:String(error.message).slice(0,1500)});throw error;}
  }
  snapshot(id) {
    const p=this.service.store.get(id),panels=p.pages.flatMap(page=>page.panels),bubbles=p.pages.flatMap(page=>page.bubbles);
    const phases=Object.fromEntries(this.db.prepare('SELECT phase,body FROM workflow_progress WHERE project=?').all(id).map(row=>[row.phase,JSON.parse(row.body)]));
    const jobs=this.service.store.jobs(id).map(job=>({id:job.id,pageId:job.pageId,state:job.status,completed:job.completed.length,total:job.panels.length,model:job.generation?.model_id,progress:job.progress,error:job.error,startedAt:job.createdAt,finishedAt:job.finishedAt}));
    const edits=this.db.prepare("SELECT body FROM integrations WHERE session=? AND kind='edit-job' ORDER BY rowid DESC LIMIT 6").all(id).map(row=>{const j=JSON.parse(row.body);return {id:j.id,state:j.status,mode:j.mode,message:j.progress,error:j.error,startedAt:j.createdAt,finishedAt:j.finishedAt};});
    const currentJobs=[...new Map([...jobs].reverse().map(j=>[j.pageId,j])).values()];
    const working=currentJobs.find(j=>active(j.state)),failed=currentJobs.find(j=>failure(j.state));
    const count=panels.filter(panel=>panel.image).length;
    const lines=panels.flatMap(panel=>panel.dialogue.map(d=>d.text)),available=bubbles.map(b=>b.text);
    let entered=0;for(const text of lines){const i=available.indexOf(text);if(i>=0){entered++;available.splice(i,1);}}
    const warning=letteringWarnings(p),exported=phases.export;
    const stages=[
      {id:'script',label:'脚本',state:phases.draft&&phases.draft.state!=='completed'?phases.draft.state:p.approved?'completed':p.pages.length?'review':'pending',detail:p.pages.length?`${p.pages.length}ページ${p.approved?' · 確定済み':' · 確認待ち'}`:'Gemmaの脚本を待っています',error:phases.draft?.error},
      {id:'letter',label:'台詞',state:warning.length?'review':lines.length&&entered===lines.length?'completed':entered?'review':panels.length&&!lines.length?'optional':'pending',detail:`${entered}/${lines.length}本入力 · ${bubbles.filter(b=>b.direction==='vertical').length}個が縦書き`,error:warning.join(' ／ ')},
      {id:'render',label:'作画',state:working?.state||failed?.state||(panels.length&&count===panels.length?'completed':'pending'),detail:working?`${working.pageId} · ${working.completed}/${working.total}コマ生成済み`:`${count}/${panels.length}コマ保存済み`,error:failed?.error},
      {id:'edit',label:'画像修正',state:edits.find(e=>active(e.state))?.state||edits[0]?.state||'optional',detail:edits.find(e=>active(e.state))?.message||edits[0]?.message||'必要なときだけ修正・モザイク',error:edits[0]?.error},
      {id:'export',label:'書き出し',state:exported?.state==='completed'&&exported.revision!==p.revision?'review':exported?.state||'pending',detail:exported?.state==='completed'?`第${exported.revision}版を書き出し済み${exported.revision!==p.revision?' · 更新あり':''}`:'SVG・HTMLの書き出し待ち',error:exported?.error},
    ];
    return {id:p.id,title:p.title,revision:p.revision,updatedAt:p.updatedAt,active:stages.some(s=>active(s.state)),stages,jobs:jobs.slice(0,6),edits};
  }
  list() {
    return this.db.prepare('SELECT id FROM projects ORDER BY json_extract(body,\'$.updatedAt\') DESC').all().map(row=>this.snapshot(row.id)).sort((a,b)=>Number(b.active)-Number(a.active)).slice(0,100);
  }
}
