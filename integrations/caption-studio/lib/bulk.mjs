import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {atomicWrite} from './storage.mjs';
export function withTrigger(caption,trigger,oldTrigger='') {
  let text=caption.trim();
  if(!text)return text;
  for(const t of [...new Set([oldTrigger.trim(),trigger.trim()])].filter(Boolean)) {
    while(text.startsWith(t) && (text.length===t.length || /^[\s,;:.]/.test(text[t.length])))text=text.slice(t.length).replace(/^[\s,;:.]+/,'');
  }
  if(!text)throw new Error('トリガー以外の本文がありません');
  return trigger.trim()?`${trigger.trim()}, ${text}`:text;
}
const fingerprint=items=>createHash('sha256').update(JSON.stringify(items.map(i=>[i.id,i.caption,i.metadata,i.reviewed]))).digest('hex');
export class BulkEdits {
  constructor(workspace){this.workspace=workspace;this.preview=null;}
  plan({ids,operation,find='',replace='',oldTrigger=''}) {
    if(!['replace','prefix','suffix','trigger'].includes(operation))throw new Error('編集方法が不正です');
    for(const s of [find,replace,oldTrigger])if(typeof s!=='string'||s.length>6000)throw new Error('編集内容が不正です');
    if(operation==='replace'&&!find)throw new Error('検索する文字列を入力してください');
    const items=[...new Set(ids)].map(id=>this.workspace.item(id));
    const changes=[];
    for(const i of items){if(!i.caption.trim())continue;let after=i.caption;
      if(operation==='replace')after=after.split(find).join(replace);
      if(operation==='prefix')after=replace+after;
      if(operation==='suffix')after+=replace;
      if(operation==='trigger')after=withTrigger(after,this.workspace.project.settings.trigger,oldTrigger);
      if(after!==i.caption)changes.push({id:i.id,file:i.relative,before:i.caption,after});
    }
    this.preview={id:randomUUID(),projectId:this.workspace.project.id,fingerprint:fingerprint(items),ids:items.map(i=>i.id),changes};
    return {id:this.preview.id,count:changes.length,changes:changes.slice(0,50),trigger:this.workspace.project.settings.trigger};
  }
  async apply(id){const p=this.preview;if(!p||p.id!==id||p.projectId!==this.workspace.require().id)throw new Error('プレビューを再作成してください');
    if(fingerprint(p.ids.map(id=>this.workspace.item(id)))!==p.fingerprint)throw new Error('プレビュー後に編集されています。再確認してください');
    await atomicWrite(path.join(this.workspace.root,'edit-history',p.projectId,p.id+'.json'),JSON.stringify(p,null,2));
    for(const c of p.changes){const i=this.workspace.item(c.id);i.caption=c.after;i.reviewed=false;i.status=i.caption?'ready':'empty';i.error='';}
    await this.workspace.persist();this.preview=null;return {changed:p.changes.length,project:this.workspace.snapshot()};
  }
}
