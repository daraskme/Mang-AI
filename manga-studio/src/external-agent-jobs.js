import {readFileSync,writeFileSync,renameSync,realpathSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

const active=j=>['queued','running','approval'].includes(j.status);
async function setDevinModel(rpc,session,model){
  const option=session.configOptions?.find(o=>o.category==='model'||o.id==='model');
  if(option){
    const result=await rpc.request('session/set_config_option',{sessionId:session.sessionId,configId:option.id,value:model});
    if(result.configOptions?.find(o=>o.id===option.id)?.currentValue!==model)throw Error('指定モデルを確認できません');
  }else if(session.models)await rpc.request('session/set_model',{sessionId:session.sessionId,modelId:model});
  else throw Error('CLIがモデルの選択に対応していません');
}
export class ExternalAgentJobs {
  constructor(accounts,{sessionDirectory}){
    this.accounts=accounts;this.sessionDirectory=sessionDirectory;this.file=join(accounts.directory,'jobs.json');this.pending=new Map();this.bindings=new Map();this.watchedClients=new WeakSet();
    try{this.jobs=JSON.parse(readFileSync(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;this.jobs=[];}
    for(const j of this.jobs)if(active(j)){j.status='interrupted';j.phase='Mang-AIが再起動しました。完了は未確認です';delete j.approval;}
    accounts.onNotification=(id,m)=>this.notification(id,m);accounts.onRequest=(id,m,rpc)=>this.request(id,m,rpc);
    accounts.isBusy=id=>this.jobs.some(j=>j.accountId===id&&active(j));
  }
  save(){const temp=this.file+'.tmp';writeFileSync(temp,JSON.stringify(this.jobs.slice(-200)),{mode:0o600});renameSync(temp,this.file);}
  get(session,id){const j=this.jobs.find(j=>j.id===id&&j.session===session);if(!j)throw Error('このセッションに属する作業が見つかりません');return structuredClone(j);}
  list(session){return this.jobs.filter(j=>j.session===session).slice(-12).map(j=>structuredClone(j));}
  async start(session,{prompt}){
    if(typeof prompt!=='string'||!prompt.trim()||prompt.length>100000)throw Error('依頼内容を1〜100000文字で入力してください');
    const selection=this.accounts.selection(session);if(!selection)throw Error('このセッションのCodex / Devin担当を選んでください');
    if(this.jobs.some(j=>j.session===session&&active(j)))throw Error('このセッションの担当は作業中です');
    const a=this.accounts.account(selection.accountId);
    const directory=await this.sessionDirectory(session);if(!directory)throw Error('セッションの作業フォルダーを取得できません');
    const cwd=realpathSync(directory);if(!statSync(cwd).isDirectory())throw Error('作業フォルダーがありません');
    // The directory lookup can yield; recheck before reserving this session.
    if(this.jobs.some(j=>j.session===session&&active(j)))throw Error('このセッションの担当は作業中です');
    const job={id:randomUUID(),session,provider:a.provider,accountId:a.id,accountLabel:a.label,model:selection.model,cwd,prompt:prompt.trim(),status:'queued',phase:'開始準備',output:'',startedAt:Date.now()};
    this.jobs.push(job);this.save();this.run(job).catch(()=>{if(active(job)){job.status='failed';job.phase='担当CLIで作業を開始・継続できませんでした';this.save();}});return structuredClone(job);
  }
  async run(job){
    const account=await this.accounts.refresh(job.accountId);if(!account.authenticated)throw Error('ログインが必要です');
    const rpc=await this.accounts.connect(job.accountId),key=JSON.stringify([job.session,job.accountId,job.model,job.cwd]);
    let binding=this.bindings.get(key);
    if(!this.watchedClients.has(rpc)){
      this.watchedClients.add(rpc);
      rpc.once('closed',()=>{
        for(const j of this.jobs)if(j.accountId===job.accountId&&active(j)){j.status='interrupted';j.phase='CLIとの接続が切れました。完了は未確認です';j.endedAt=Date.now();delete j.approval;}
        for(const [id,p]of this.pending)if(p.rpc===rpc)this.pending.delete(id);
        for(const k of this.bindings.keys())if(JSON.parse(k)[1]===job.accountId)this.bindings.delete(k);
        this.save();
      });
    }
    if(!binding){
      const saved=this.accounts.state.threads?.[key];
      if(saved){
        if(job.provider==='codex')await rpc.request('thread/resume',{threadId:saved.threadId,model:job.model,cwd:job.cwd,approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:'workspace-write'});
        else {const result=await rpc.request('session/load',{sessionId:saved.threadId,cwd:job.cwd,mcpServers:[]});await setDevinModel(rpc,{...result,sessionId:saved.threadId},job.model);}
        binding=saved;
      }else if(job.provider==='codex'){
        const result=await rpc.request('thread/start',{model:job.model,cwd:job.cwd,approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:'workspace-write',developerInstructions:'Mang-AIのこのセッションのコーディング担当です。依頼の範囲で作業し、日本語で結果・変更・検証を報告してください。'});
        binding={threadId:result.thread.id};
      }else{
        const result=await rpc.request('session/new',{cwd:job.cwd,mcpServers:[]});binding={threadId:result.sessionId};
        await setDevinModel(rpc,result,job.model);
        // The CLI keeps its normal approval mode. No bypass or dangerous flag.
      }
      this.bindings.set(key,binding);
      this.accounts.state.threads||={};this.accounts.state.threads[key]=binding;this.accounts.save();
    }
    job.threadId=binding.threadId;job.status='running';job.phase='応答・作業中';this.save();
    if(job.provider==='codex'){
      const result=await rpc.request('turn/start',{threadId:job.threadId,input:[{type:'text',text:job.prompt}],model:job.model});job.turnId=result.turn.id;this.save();
    }else{
      const result=await rpc.request('session/prompt',{sessionId:job.threadId,prompt:[{type:'text',text:job.prompt}]},24*60*60*1000);
      if(active(job)){job.status=result.stopReason==='end_turn'?'completed':result.stopReason==='cancelled'?'cancelled':'stopped';job.phase=job.status==='completed'?'完了':`停止: ${result.stopReason||'不明'}`;job.endedAt=Date.now();delete job.approval;this.save();}this.accounts.refresh(job.accountId,true).catch(()=>{});
    }
  }
  find(accountId,params){const thread=params.threadId||params.sessionId;return this.jobs.findLast(j=>j.accountId===accountId&&j.threadId===thread&&active(j));}
  notification(accountId,message){
    const p=message.params||{},job=this.find(accountId,p);if(!job)return;
    if(message.method==='item/agentMessage/delta'){job.output=(job.output+p.delta).slice(-200000);job.phase='応答中';}
    if(message.method==='item/started'){if(p.item?.type==='commandExecution')job.phase='コマンドを実行中';if(p.item?.type==='fileChange')job.phase='ファイルを変更中';}
    if(message.method==='turn/completed'){job.status=p.turn?.status==='completed'?'completed':p.turn?.status==='interrupted'?'cancelled':'failed';job.phase=job.status==='completed'?'完了':'停止・エラー';job.endedAt=Date.now();delete job.approval;this.save();this.accounts.refresh(accountId,true).catch(()=>{});}
    if(message.method==='session/update'){
      const u=p.update||{};if(u.sessionUpdate==='agent_message_chunk'&&u.content?.type==='text'){job.output=(job.output+u.content.text).slice(-200000);job.phase='応答中';}
      if(['tool_call','tool_call_update'].includes(u.sessionUpdate))job.phase=String(u.title||'ツール実行中').slice(0,160);
    }
  }
  request(accountId,message,rpc){
    const job=this.find(accountId,message.params||{});const method=message.method;
    if(!job){rpc.send({id:message.id,error:{code:-32601,message:'Unsupported request'}});return;}
    const allowed=['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval','item/tool/requestUserInput','session/request_permission'];
    if(!allowed.includes(method)){rpc.send({id:message.id,error:{code:-32601,message:'Unsupported request'}});return;}
    const id=randomUUID();this.pending.set(id,{rpc,message,jobId:job.id});job.approval||={id,method,details:message.params};job.status='approval';job.phase='承認・回答を待っています';this.save();
  }
  respond(session,{jobId,approvalId,allow,answers}){
    this.get(session,jobId);const p=this.pending.get(approvalId),job=this.jobs.find(j=>j.id===jobId);if(!p||p.jobId!==jobId)throw Error('この承認要求は終了しています');
    const {method,params}=p.message;let result;
    if(method==='session/request_permission'){
      const option=params.options.find(o=>o.kind===(allow?'allow_once':'reject_once'));
      result={outcome:option?{outcome:'selected',optionId:option.optionId}:{outcome:'cancelled'}};
    }else if(method==='item/tool/requestUserInput'){
      result={answers:Object.fromEntries((params.questions||[]).map(q=>[q.id,{answers:typeof answers?.[q.id]==='string'?[answers[q.id].slice(0,20000)]:[]}]))};
    }else if(method==='item/permissions/requestApproval')result={permissions:allow?params.permissions:{},scope:'turn'};
    else result={decision:allow?'accept':'decline'};
    p.rpc.send({id:p.message.id,result});this.pending.delete(approvalId);delete job.approval;
    const next=[...this.pending].find(([,v])=>v.jobId===jobId);if(next)job.approval={id:next[0],method:next[1].message.method,details:next[1].message.params};
    job.status=next?'approval':'running';job.phase=next?'承認・回答を待っています':'応答・作業中';this.save();return this.get(session,jobId);
  }
  async cancel(session,id){const job=this.jobs.find(j=>j.id===id&&j.session===session);if(!job)throw Error('作業が見つかりません');if(!active(job))return this.get(session,id);const rpc=await this.accounts.connect(job.accountId);
    if(job.provider==='codex'&&job.turnId)await rpc.request('turn/interrupt',{threadId:job.threadId,turnId:job.turnId});else if(job.provider==='devin'&&job.threadId)rpc.send({method:'session/cancel',params:{sessionId:job.threadId}});else throw Error('開始処理中です。少し待ってから中止してください');
    job.status='cancelled';job.phase='中止';job.endedAt=Date.now();delete job.approval;for(const [key,p]of this.pending)if(p.jobId===id)this.pending.delete(key);this.save();return this.get(session,id);
  }
  close(){for(const job of this.jobs)if(active(job)){job.status='interrupted';job.phase='Mang-AI終了による中断';delete job.approval;}this.save();}
}
