import {sessionKey} from './store.js';

/** Explicit reference selection; never modifies or sends the conversation draft. */
export class SessionMedia {
  constructor(service,gallery){this.service=service;this.gallery=gallery;}
  reference(session,referenceId){
    const row=referenceId?this.service.store.db.prepare("SELECT body FROM integrations WHERE session=? AND kind='media-reference-link' AND id=?").get(sessionKey(session),'reference-'+sessionKey(session)+'-'+referenceId):this.service.store.db.prepare("SELECT body FROM integrations WHERE session=? AND kind='media-reference'").get(sessionKey(session));
    if(referenceId&&!row)throw Error('この会話に登録されていない参照素材です。ギャラリーで「会話で使う」を選んでください');
    return row?JSON.parse(row.body):null;
  }
  async select(session,id){
    if(!session||session==='gallery')throw Error('素材を使うセッションを開いてください');
    if(!id){this.service.store.db.prepare("DELETE FROM integrations WHERE session=? AND kind='media-reference'").run(sessionKey(session));return {reference:null};}
    const detail=await this.gallery.detail(id);await this.gallery.file(id);
    const reference={id:detail.id,referenceId:detail.id,name:detail.name,kind:detail.kind,file:detail.file||null,projectId:detail.projectId||null,pageId:detail.pageId||null,caption:detail.caption,selectedAt:new Date().toISOString()};
    this.service.studios.save(session,'media-reference-link',reference,'reference-'+sessionKey(session)+'-'+detail.id);
    this.service.studios.save(session,'media-reference',reference,'reference-'+sessionKey(session));
    return {reference};
  }
  async snapshot(session){
    if(!session||session==='gallery')return {items:[],reference:null,total:0};
    const key=sessionKey(session),collections=(await this.gallery.catalog()).filter(c=>c.id==='s-'+key||c.id==='p-'+key),items=[];
    let total=0;
    for(const c of collections){const result=await this.gallery.list(c.id,{limit:8});total+=result.total;items.push(...result.items);}
    items.sort((a,b)=>(b.mtime||0)-(a.mtime||0));
    return {session,items:items.slice(0,8),total,reference:this.reference(session)};
  }
}
