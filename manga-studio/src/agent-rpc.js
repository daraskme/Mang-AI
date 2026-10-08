import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';

/** Private stdio connection: protocol payloads and stderr never enter server logs. */
export class AgentRPC extends EventEmitter {
  constructor(command,args,options={}) {
    super();this.nextId=0;this.pending=new Map();this.buffer='';this.closed=false;
    this.child=spawn(command,args,{...options,stdio:['pipe','pipe','pipe']});
    this.child.stderr.on('data',()=>{});
    this.child.stdin.on('error',()=>this.fail('CLIへの接続が切れました'));
    this.child.on('error',()=>this.fail('CLIを起動できません。実行ファイルを確認してください'));
    this.child.on('exit',()=>this.fail('CLIが終了しました'));
    this.child.stdout.on('data',chunk=>{
      this.buffer+=chunk;
      if(this.buffer.length>16*1024*1024){this.close();return;}
      let end;while((end=this.buffer.indexOf('\n'))!==-1){
        const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);let m;try{m=JSON.parse(line);}catch{continue;}
        if(m.method){this.emit(m.id===undefined?'notification':'request',m);continue;}
        const request=this.pending.get(m.id);if(!request)continue;
        this.pending.delete(m.id);clearTimeout(request.timer);
        if(m.error){const e=Error('CLIが要求を処理できませんでした');e.code=m.error.code;request.reject(e);}else request.resolve(m.result);
      }
    });
  }
  send(message){if(this.closed)throw Error('CLIは接続されていません');this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',...message})+'\n');}
  request(method,params={},timeoutMs=45000){
    if(this.closed)return Promise.reject(Error('CLIは接続されていません'));
    const id=++this.nextId;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('CLIの応答がタイムアウトしました'));},timeoutMs);timer.unref();this.pending.set(id,{resolve,reject,timer});this.send({id,method,params});});
  }
  fail(message){if(this.closed)return;this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error(message));}this.pending.clear();this.emit('closed');}
  close(){this.fail('CLIへの接続を終了しました');this.child.kill('SIGTERM');const timer=setTimeout(()=>{if(this.child.exitCode===null)this.child.kill('SIGKILL');},3000);timer.unref();}
}

export function privateAgentEnv(provider,directory,ambient=process.env){
  const env=Object.fromEntries(Object.entries(ambient).filter(([k])=>!(/^(CODEX_|OPENAI_|DEVIN_|WINDSURF_|COGNITION_|ANTHROPIC_)/.test(k))));
  if(provider==='codex')env.CODEX_HOME=directory;
  else {env.XDG_DATA_HOME=directory+'/data';env.XDG_CONFIG_HOME=directory+'/config';env.XDG_CACHE_HOME=directory+'/cache';}
  return env;
}

const percent=n=>typeof n==='number'&&Number.isFinite(n)?Math.max(0,Math.min(100,n)):null;
const reset=n=>typeof n==='number'&&Number.isFinite(n)&&n>0?n:null;
export function codexQuota(result,now=Date.now()){
  const buckets=result.rateLimitsByLimitId&&Object.keys(result.rateLimitsByLimitId).length?Object.values(result.rateLimitsByLimitId):result.rateLimits?[result.rateLimits]:[];
  return {updatedAt:now,windows:buckets.flatMap(b=>['primary','secondary'].flatMap(key=>{
    const w=b[key];if(!w)return [];const used=percent(w.usedPercent);
    return [{id:(b.limitId||'codex')+':'+key,label:b.limitName||b.limitId||'Codex',minutes:typeof w.windowDurationMins==='number'?w.windowDurationMins:null,remainingPercent:used===null?null:100-used,resetsAt:reset(w.resetsAt)}];
  }))};
}
export function devinQuota(result,now=Date.now()){
  const user=result.userStatus||result.user_status||result;
  const plan=user.planStatus||user.plan_status;
  if(!plan)return {updatedAt:now,windows:[],unavailable:true};
  const value=(snake,camel)=>plan[snake]??plan[camel];
  return {updatedAt:now,windows:['daily','weekly'].flatMap(kind=>{
    const remaining=percent(value(kind+'_quota_remaining_percent',kind+'QuotaRemainingPercent'));
    const raw=value(kind+'_quota_reset_at_unix',kind+'QuotaResetAtUnix');
    const resetsAt=reset(typeof raw==='string'&&/^\d+$/.test(raw)?Number(raw):raw);
    return remaining===null&&!resetsAt?[]:[{id:kind,label:kind==='daily'?'日次':'週次',minutes:kind==='daily'?1440:10080,remainingPercent:remaining,resetsAt}];
  })};
}
