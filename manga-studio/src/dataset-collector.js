import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {sessionKey} from './store.js';
const execute=promisify(execFile);
const hosts=new Set(['x.com','www.x.com','twitter.com','www.twitter.com','pixiv.net','www.pixiv.net','gelbooru.com','www.gelbooru.com','pawchive.pw','www.pawchive.pw']);
const secretKeys=new Set(['token','api_key','api-key','password','auth','authorization','key']);
export function collectionPlan(args){
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(args.dataset||''))throw Error('dataset は英数字・ハイフン・下線の1〜64文字です');
  if(!Array.isArray(args.urls)||args.urls.length<1||args.urls.length>20)throw Error('urls は1〜20件です');
  const urls=args.urls.map(value=>{
    const u=new URL(value);
    if(u.protocol!=='https:'||u.username||u.password||u.port&&!['443'].includes(u.port)||!hosts.has(u.hostname))throw Error('X・Pixiv・Gelbooru・PawchiveのHTTPS URLを指定してください');
    if([...u.searchParams.keys()].some(k=>secretKeys.has(k.toLowerCase())))throw Error('認証情報はURLではなくローカル設定へ保存してください');
    return u.href;
  });
  const limit=args.limit??100;
  if(!Number.isInteger(limit)||limit<1||limit>1000)throw Error('limit は1〜1000です');
  return {dataset:args.dataset,urls,limit};
}
async function atomic(path,value){const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value,null,2),{mode:0o600});await rename(temp,path);}

export class DatasetCollector {
  constructor({root,python,spawnProcess=spawn}){
    this.root=resolve(root);this.python=python||join(this.root,'caption-studio/runtime/python-run');
    this.script=join(this.root,'manga-studio/scripts/collect-dataset.py');
    this.jobsRoot=join(this.root,'work/dataset-collection');this.running=new Map();this.spawnProcess=spawnProcess;
  }
  async sources(signal){
    try{
      const {stdout}=await execute(this.python,[this.script,'--root',this.root,'--doctor'],{signal,timeout:10000,maxBuffer:16384});
      return JSON.parse(stdout);
    }catch{return {ready:false,guide:'manga-studio/docs/dataset-collection.md',message:'収集用Python・gallery-dl・認証設定の形式を確認してください'};}
  }
  async start(session,args){
    const spec=collectionPlan(args),id=randomUUID(),dir=join(this.jobsRoot,id);
    if([...this.running.values()].some(j=>j.dataset===spec.dataset))throw Error('同じデータセットの収集が実行中です');
    await mkdir(dir,{recursive:true,mode:0o700});
    await atomic(join(dir,'request.json'),spec);
    await atomic(join(dir,'owner.json'),{session:sessionKey(session)});
    await atomic(join(dir,'status.json'),{state:'queued',dataset:spec.dataset});
    const child=this.spawnProcess(this.python,[this.script,'--root',this.root,'--spec',join(dir,'request.json'),'--status',join(dir,'status.json')],
      {shell:false,stdio:['ignore','ignore','ignore'],env:{...process.env,PYTHONUNBUFFERED:'1'}});
    this.running.set(id,{child,dataset:spec.dataset});
    let finished=false;
    const finish=async(code)=>{
      if(finished)return;finished=true;
      this.running.delete(id);
      const file=join(dir,'status.json');const state=JSON.parse(await readFile(file,'utf8'));
      if(['queued','running'].includes(state.state))await atomic(file,{...state,state:'failed',exitCode:code,message:'収集プロセスが完了前に終了しました。設定と依存関係を確認してください'});
    };
    child.once('error',()=>void finish(null).catch(()=>{}));child.once('close',code=>void finish(code).catch(()=>{}));
    return {id,state:'queued',dataset:spec.dataset,limit:spec.limit,next:'dataset_collection_job で進捗を確認してください'};
  }
  async job(session,id,action='status'){
    if(!/^[0-9a-f-]{36}$/.test(id))throw Error('収集ジョブIDが不正です');
    const dir=join(this.jobsRoot,id),owner=JSON.parse(await readFile(join(dir,'owner.json'),'utf8'));
    if(owner.session!==sessionKey(session))throw Error('別セッションの収集は操作できません');
    if(!['status','cancel'].includes(action))throw Error('action は status/cancel です');
    if(action==='cancel'){
      const job=this.running.get(id);
      if(job){job.child.kill('SIGTERM');setTimeout(()=>{if(this.running.has(id))job.child.kill('SIGKILL');},5000).unref();}
    }
    return {id,...JSON.parse(await readFile(join(dir,'status.json'),'utf8'))};
  }
  close(){for(const {child}of this.running.values())child.kill('SIGTERM');}
}

export function registerDatasetTools(register,collector){
  register('dataset_sources','画像収集ツールとX・Pixiv・Gelbooru・Pawchiveの認証設定の有無を調べる。秘密の値は返さない。',{},(_a,e)=>collector.sources(e.signal));
  register('dataset_collect','利用者が指定したURLから学習候補の画像を収集する。X/Pixiv/Gelbooru/Pawchiveに対応。既定はplan。runは収集を依頼された場合のみ。原本と長辺2048以下のAVIFコピーを残す。',{
    dataset:{type:'string',required:true,description:'英数字・ハイフン・下線の保存名'},
    urls:{type:'array',items:{type:'string'},required:true,description:'利用者が指定した投稿・作者・検索URL、1〜20件'},
    limit:{type:'integer',description:'画像候補の上限1〜1000、既定100'},
    action:{type:'string',enum:['plan','run'],description:'準備・手順の依頼はplan。収集依頼を受けたらrun'},
  },(args,e)=>{
    if(!['plan','run',undefined].includes(args.action))throw Error('action は plan/run です');
    return args.action==='run'?collector.start(e.agent.id,args):{...collectionPlan(args),networkAccess:false,next:'指定範囲の収集を依頼されていれば action:run'};
  });
  register('dataset_collection_job','このセッションの画像収集の進捗・結果フォルダを取得、または中止する。完了後のfolderをcaption_openへ渡す。failed/skippedも確認する。',{
    id:{type:'string',required:true},action:{type:'string',enum:['status','cancel']},
  },(args,e)=>collector.job(e.agent.id,args.id,args.action));
}
