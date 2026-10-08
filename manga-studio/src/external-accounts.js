import {mkdirSync,readFileSync,writeFileSync,renameSync,chmodSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {AgentRPC,privateAgentEnv,codexQuota} from './agent-rpc.js';

const ID=/^[a-f0-9-]{36}$/;
const safeLabel=value=>{if(typeof value!=='string'||!value.trim()||value.length>80)throw Error('アカウント名は1〜80文字で入力してください');return value.trim();};
export class ExternalAccounts {
  constructor({directory,codex='codex',devin='devin',python='python3',loginHelper,credentials,readDevinUsage}){
    this.directory=directory;this.commands={codex,devin};this.python=python;this.loginHelper=loginHelper;this.credentials=credentials;this.readDevinUsage=readDevinUsage;
    mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
    this.file=join(directory,'accounts.json');this.clients=new Map();this.connecting=new Map();this.live=new Map();this.refreshing=new Map();this.logins=new Map();
    try{this.state=JSON.parse(readFileSync(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;this.state={accounts:[],sessions:{}};}
    this.onNotification=()=>{};this.onRequest=()=>{};
  }
  save(){const temp=this.file+'.tmp';writeFileSync(temp,JSON.stringify(this.state,null,2)+'\n',{mode:0o600});chmodSync(temp,0o600);renameSync(temp,this.file);}
  account(id){const a=this.state.accounts.find(a=>a.id===id);if(!a||!ID.test(id))throw Error('アカウントが見つかりません');return a;}
  profile(id){this.account(id);return join(this.directory,id);}
  sessionKey(session){if(typeof session!=='string'||!session||session.length>256||['__proto__','prototype','constructor'].includes(session))throw Error('セッションを指定してください');return session;}
  selection(session){return this.state.sessions[this.sessionKey(session)]||null;}
  select(session,{accountId,model}){this.sessionKey(session);if(accountId===null){delete this.state.sessions[session];this.save();return null;}this.account(accountId);if(typeof model!=='string'||!model||model.length>160)throw Error('モデルを選んでください');const models=this.live.get(accountId)?.models;if(!models?.some(m=>m.id===model))throw Error('アカウントのモデル一覧を更新して選択してください');this.state.sessions[session]={accountId,model};this.save();return this.selection(session);}
  add({provider,label}){if(!['codex','devin'].includes(provider))throw Error('CodexまたはDevinを選んでください');if(this.state.accounts.length>=20)throw Error('アカウントは20件までです');const a={id:randomUUID(),provider,label:safeLabel(label)};this.state.accounts.push(a);mkdirSync(this.profile(a.id),{recursive:true,mode:0o700});this.save();return a;}
  rename(id,label){this.account(id).label=safeLabel(label);this.save();}
  async connect(id){
    if(this.clients.get(id)&&!this.clients.get(id).closed)return this.clients.get(id);
    if(this.connecting.has(id))return this.connecting.get(id);
    const pending=(async()=>{
      const a=this.account(id),env=privateAgentEnv(a.provider,this.profile(id));
      const args=a.provider==='codex'?['app-server','-c','cli_auth_credentials_store="file"','-c','forced_login_method="chatgpt"']:['--permission-mode','auto','acp'];
      const rpc=new AgentRPC(this.commands[a.provider],args,{env,cwd:this.profile(id)});
      this.clients.set(id,rpc);
      rpc.on('notification',message=>{
        if(message.method==='account/rateLimits/updated'){const s=this.live.get(id)||{};this.live.set(id,{...s,quota:codexQuota(message.params)});}
        if(message.method==='account/login/completed'){
          this.logins.delete(id);this.live.set(id,{...this.live.get(id),loginError:message.params.success?null:'ログインできませんでした。もう一度お試しください'});
          this.refresh(id,true).catch(()=>{});
        }
        this.onNotification(id,message);
      });
      rpc.on('request',message=>this.onRequest(id,message,rpc));
      rpc.on('closed',()=>{if(this.clients.get(id)===rpc)this.clients.delete(id);});
      try{
        await rpc.request('initialize',a.provider==='codex'?{clientInfo:{name:'mang_ai',title:'Mang-AI',version:'0.1.0'}}:{protocolVersion:1,clientInfo:{name:'mang-ai',version:'0.1.0'},clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false}});
        if(a.provider==='codex')rpc.send({method:'initialized'});
      }catch(e){rpc.close();throw e;}
      return rpc;
    })();this.connecting.set(id,pending);try{return await pending;}finally{this.connecting.delete(id);}
  }
  async refresh(id,force=false){
    const old=this.live.get(id)||{};if(!force&&old.checkedAt&&Date.now()-old.checkedAt<60000)return old;
    if(this.refreshing.has(id))return this.refreshing.get(id);
    const pending=(async()=>{
      const a=this.account(id);let next={...old,checkedAt:Date.now(),error:null};
      try{
        if(a.provider==='codex'){
          const rpc=await this.connect(id),result=await rpc.request('account/read',{});
          next.authenticated=result.account?.type==='chatgpt';next.email=result.account?.email||null;next.plan=result.account?.planType||null;
          if(next.authenticated){
            const [quota,models]=await Promise.allSettled([rpc.request('account/rateLimits/read'),rpc.request('model/list',{limit:100})]);
            if(quota.status==='fulfilled')next.quota=codexQuota(quota.value);else next.error='利用枠を取得できませんでした';
            if(models.status==='fulfilled')next.models=models.value.data.map(m=>({id:m.model||m.id,name:m.displayName||m.model||m.id}));
          }else {next.quota=null;next.models=[];}
        }else{
          const credential=join(this.profile(id),'data/devin/credentials.toml');next.authenticated=existsSync(credential);
          if(next.authenticated){
            if(this.readDevinUsage){try{const result=await this.readDevinUsage(credential);next.quota=result.quota;next.plan=result.plan;next.email=result.email;}catch(e){next.error=e.status===403?'Devinの残量APIが403で拒否しました。公式Devinで契約・アクセス状態を確認してください':e.status===401?'Devinの認証が拒否されました。再ログインしてください':'Devinの利用枠を取得できませんでした';}}
            else next.error='Devinの利用枠は未取得です';
            if(!next.models?.length){const rpc=await this.connect(id);const result=await rpc.request('session/new',{cwd:this.profile(id),mcpServers:[]});
              next.models=(result.configOptions?.find(o=>o.id==='model')?.options||result.models?.availableModels||[]).map(m=>({id:m.value||m.modelId,name:m.name}));
            }
          }else {next.quota=null;next.models=[];}
        }
      }catch{next.error='アカウントを確認できません。CLIの導入・ログイン状態を確認してください';}
      this.live.set(id,next);return next;
    })();this.refreshing.set(id,pending);try{return await pending;}finally{this.refreshing.delete(id);}
  }
  async login(id,mode='device'){
    if(this.isBusy?.(id))throw Error('作業中のアカウントは再ログインできません');
    const a=this.account(id);if(this.logins.has(id))return this.logins.get(id).public;
    this.live.set(id,{...this.live.get(id),loginError:null});
    if(a.provider==='codex'){
      const rpc=await this.connect(id),result=await rpc.request('account/login/start',{type:mode==='browser'?'chatgpt':'chatgptDeviceCode'});
      const pub={url:result.verificationUrl||result.authUrl,code:result.userCode||null,kind:mode};this.logins.set(id,{public:pub,loginId:result.loginId});return pub;
    }
    const child=spawn(this.python,[this.loginHelper,this.commands.devin],{env:privateAgentEnv('devin',this.profile(id)),cwd:this.profile(id),stdio:['pipe','pipe','pipe']});
    child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
    return new Promise((resolve,reject)=>{
      let buffer='',settled=false;const timer=setTimeout(()=>{child.kill();reject(Error('ログインURLを取得できませんでした'));},20000);
      child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let value;try{value=JSON.parse(line);}catch{continue;}
        if(value.url){const url=new URL(value.url);if(url.origin!=='https://app.devin.ai')continue;const pub={url:value.url,kind:'code'};this.logins.set(id,{child,public:pub});clearTimeout(timer);settled=true;resolve(pub);}
      }});
      let finished=false;
      const done=code=>{if(finished)return;finished=true;clearTimeout(timer);const cancelled=this.logins.get(id)?.cancelled;this.logins.delete(id);this.live.set(id,{...this.live.get(id),loginError:code===0||cancelled?null:'ログインが完了しませんでした。「ログイン」から新しいコードを取得してください'});if(!settled)reject(Error('Devinログインを開始できませんでした'));this.clients.get(id)?.close();this.refresh(id,true).catch(()=>{});};
      child.on('error',done);child.on('exit',done);
    });
  }
  submitCode(id,code){const login=this.logins.get(id);if(!login?.child||typeof code!=='string'||!code.trim()||code.length>16384||/[\r\n]/.test(code))throw Error('有効なログインコードを入力してください');login.child.stdin.write(JSON.stringify({code})+'\n');}
  async cancelLogin(id){const login=this.logins.get(id);if(login?.child){login.cancelled=true;login.child.kill();}if(login?.loginId)await (await this.connect(id)).request('account/login/cancel',{loginId:login.loginId});if(!login?.child)this.logins.delete(id);}
  async logout(id){if(this.isBusy?.(id))throw Error('このアカウントの作業を中止してからログアウトしてください');await this.cancelLogin(id);const a=this.account(id);if(a.provider==='codex')await (await this.connect(id)).request('account/logout');else await new Promise((resolve,reject)=>{const p=spawn(this.commands.devin,['auth','logout'],{cwd:this.profile(id),env:privateAgentEnv('devin',this.profile(id)),stdio:'ignore'});p.once('error',()=>reject(Error('ログアウトできませんでした')));p.once('exit',code=>code===0?resolve():reject(Error('ログアウトできませんでした')));});this.clients.get(id)?.close();this.live.delete(id);}
  async snapshot(session,{refresh=false}={}){const selected=session?this.selection(session):null;if(selected&&refresh)await this.refresh(selected.accountId);return {accounts:this.state.accounts.map(a=>({...a,...this.live.get(a.id),login:this.logins.get(a.id)?.public||null})),selection:selected,jobs:session?this.jobs?.list(session)||[]:[],deepseek:this.credentials?await this.credentials.describe('DEEPSEEK_API_KEY'):{configured:false,writable:false}};}
  async deepseekKey(value){if(!this.credentials)throw Error('認証情報サービスが利用できません');if(value===null)return this.credentials.unset('DEEPSEEK_API_KEY');if(typeof value!=='string'||!/^[\x21-\x7e]{10,1024}$/.test(value.trim()))throw Error('有効なAPIキーを入力してください');await this.credentials.set('DEEPSEEK_API_KEY',value.trim());}
  close(){for(const l of this.logins.values())l.child?.kill();for(const rpc of this.clients.values())rpc.close();}
}
