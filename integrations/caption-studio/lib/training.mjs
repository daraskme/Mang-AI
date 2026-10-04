import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {atomicWrite,exists} from './storage.mjs';
const execute=promisify(execFile);
const APP_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const TRAIN_MODELS={dit:path.join(APP_ROOT,'models/krea2/krea2_raw_bf16.safetensors'),vae:path.join(APP_ROOT,'models/krea2/qwen_image_vae.safetensors'),textEncoder:path.join(APP_ROOT,'models/krea2/qwen3_vl_4b.safetensors')};
export async function gpuInfo(){
  try{const {stdout}=await execute('/run/current-system/sw/bin/nvidia-smi',['--query-gpu=name,memory.total,memory.free','--format=csv,noheader,nounits'],{timeout:5000});const [name,total,free]=stdout.trim().split('\n')[0].split(',').map(s=>s.trim());return {name,total:Number(total),free:Number(free)};}catch{return {name:'GPUを検出できません',total:0,free:0};}
}
export function recommendTraining(mode,count,gpu){
  const exposures={character:45,concept:55,style:65}[mode]||45;
  const steps=Math.max(300,Math.min(3000,Math.round(count*exposures/100)*100));
  const free=gpu.free/1024;
  const memory=free>=42?'bf16':free>=20?'fp8':free>=12?'swap':'low';
  return {resolution:memory==='low'?768:1024,steps,rank:32,alpha:32,learningRate:{character:0.00005,concept:0.00008,style:0.0001}[mode]||0.0001,batchSize:1,gradientAccumulation:1,seed:42,fp8:memory!=='bf16',blocksToSwap:memory==='swap'?12:memory==='low'?20:0,saveEvery:Math.max(100,Math.round(steps/4/100)*100),optimizer:'adamw8bit',scope:'all',...TRAIN_MODELS,
    reasons:[`rank/alpha 32、全Linear層、SDPA、gradient checkpointingを基準にします。`,`学習率は${mode==='character'?'同一性を保つため低めの5e-5':mode==='concept'?'概念の学習と変更しやすさのバランスを狙い8e-5':'画風の学習を狙い1e-4'}。用途別の実務上の初期仮説です。`,`${count}枚 × 約${exposures}回の提示を目安に${steps}ステップ（300〜3000に制限）。画像数が多い場合は学習量を増やす調整も検討。`,`現在の空きVRAM ${free.toFixed(1)} GB に合わせて${memory==='bf16'?'BF16':memory==='fp8'?'scaled FP8':`scaled FP8 + ${memory==='swap'?12:20}ブロックをCPUへ退避`}を提案。メモリ使用量の保証ではありません。`]
  };
}
export function normalizeTraining(input){
  const c={...input};
  for(const [k,min,max]of [['resolution',256,1536],['steps',1,50000],['rank',4,256],['alpha',1,256],['batchSize',1,8],['gradientAccumulation',1,32],['seed',0,2147483647],['blocksToSwap',0,26],['saveEvery',1,50000]]){c[k]=Number(c[k]);if(!Number.isInteger(c[k])||c[k]<min||c[k]>max)throw new Error(`${k}: ${min}〜${max}の整数を指定してください`);}
  if(c.resolution%32)throw new Error('解像度は32の倍数で指定してください');
  c.learningRate=Number(c.learningRate);if(!Number.isFinite(c.learningRate)||c.learningRate<=0||c.learningRate>0.01)throw new Error('学習率は0より大きく0.01以下にしてください');
  for(const k of ['dit','vae','textEncoder'])if(typeof c[k]!=='string'||!c[k].endsWith('.safetensors'))throw new Error(`${k}にはsafetensorsファイルを指定してください`);
  if(!['adamw8bit','adamw'].includes(c.optimizer))throw new Error('optimizerが不正です');
  c.fp8=!!c.fp8;return c;
}
export function trainingCommands(root,run,c,trigger){
  const script=name=>path.join(root,'vendor/musubi-tuner/src/musubi_tuner',name+'.py'),dataset=path.join(run,'dataset.toml');
  const train=[script('krea2_train_network'),'--dit',c.dit,'--vae',c.vae,'--dataset_config',dataset,'--sdpa','--mixed_precision','bf16','--timestep_sampling','krea2_shift','--weighting_scheme','none','--optimizer_type',c.optimizer,'--learning_rate',String(c.learningRate),'--lr_scheduler','constant_with_warmup','--lr_warmup_steps',String(Math.min(100,Math.floor(c.steps*.05))),'--gradient_checkpointing','--max_data_loader_n_workers','0','--network_module','networks.lora_krea2','--network_dim',String(c.rank),'--network_alpha',String(c.alpha),'--max_train_steps',String(c.steps),'--gradient_accumulation_steps',String(c.gradientAccumulation),'--save_every_n_steps',String(c.saveEvery),'--seed',String(c.seed),'--output_dir',path.join(run,'output'),'--output_name','krea2_lora','--metadata_title',`Krea 2 ${trigger}`,'--metadata_description',`Trigger: ${trigger}; trained on Krea 2 RAW. Use this trigger in generation prompts.`,'--training_comment',`trigger=${trigger}`];
  if(c.fp8)train.push('--fp8_base','--fp8_scaled');if(c.blocksToSwap)train.push('--blocks_to_swap',String(c.blocksToSwap));
  return [
    {name:'画像のキャッシュ',args:[script('krea2_cache_latents'),'--dataset_config',dataset,'--vae',c.vae]},
    {name:'キャプションの埋め込み',args:[script('krea2_cache_text_encoder_outputs'),'--dataset_config',dataset,'--text_encoder',c.textEncoder,'--batch_size','1']},
    {name:'LoRA学習',args:train}
  ];
}
export class Training {
  constructor(root,workspace,engine,jobs){this.root=root;this.workspace=workspace;this.engine=engine;this.jobs=jobs;this.plan=null;this.current=null;this.child=null;this.logs=[];this.launching=false;}
  active(){return this.launching||['running','stopping'].includes(this.current?.state);}
  async defaults(count){const gpu=await gpuInfo();const p=this.workspace.project;return {gpu,settings:recommendTraining(p?.settings.mode||'character',Number.isInteger(count)&&count>=0?count:p?.items.length||0,gpu),job:this.status()};}
  async init(){
    const runs=await fs.readdir(path.join(this.root,'training-runs')).catch(()=>[]);
    for(const name of runs.sort().reverse()){
      try{const result=JSON.parse(await fs.readFile(path.join(this.root,'training-runs',name,'result.json'),'utf8'));this.current=result;this.logs=(await fs.readFile(path.join(result.run,'train.log'),'utf8').catch(()=> '')).split(/[\r\n]+/).filter(Boolean).slice(-100);break;}catch{}
    }
  }
  status(){return this.current?{...this.current,logs:this.logs.slice(-100)}:null;}
  async fingerprint(items){const records=[];for(const i of items){const f=await this.workspace.imagePath(i.id),s=await fs.stat(f);records.push([i.id,i.caption,s.size,s.mtimeMs]);}return createHash('sha256').update(JSON.stringify([this.workspace.project.id,this.workspace.project.settings,records])).digest('hex');}
  async prepare(input,ids){
    if(this.active())throw new Error('学習中です');if(this.jobs.active())throw new Error('キャプション生成を先に停止してください');
    const p=this.workspace.require(),c=normalizeTraining(input),trigger=p.settings.trigger;
    if(!trigger)throw new Error('学習にはトリガーワードを設定してください');
    const items=[...new Set(ids)].map(id=>this.workspace.item(id));
    if(items.length<3)throw new Error('学習画像は3枚以上を選んでください');
    const missing=items.filter(i=>!i.caption.trim()),wrong=items.filter(i=>i.caption.trim()&&!i.caption.startsWith(trigger+', '));
    if(missing.length)throw new Error(`キャプションがない画像が${missing.length}枚あります: ${missing.slice(0,5).map(i=>i.relative).join(', ')}`);
    if(wrong.length)throw new Error(`トリガーが一致しない画像が${wrong.length}枚あります。「一括編集 → トリガー統一」を実行してください。`);
    for(const [k,file]of Object.entries({python:path.join(this.root,'runtime/python-run'),trainer:path.join(this.root,'vendor/musubi-tuner/src/musubi_tuner/krea2_train_network.py'),dit:c.dit,vae:c.vae,textEncoder:c.textEncoder}))if(!await exists(file))throw new Error(`${k}が見つかりません: ${file}`);
    if(/turbo/i.test(path.basename(c.dit)))throw new Error('学習用にはTurboではなくRAW DiTを選んでください');
    const gpu=await gpuInfo();if(!gpu.total)throw new Error('CUDA GPUを検出できません。GPUドライバーを確認してください');
    const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,6),run=path.join(this.root,'training-runs',id);
    const warnings=[];if(items.some(i=>!i.reviewed))warnings.push('未確認のキャプションが含まれています。誤認識を確認してください。');
    if(gpu.free<12000)warnings.push('空きVRAMが12GB未満です。他のGPUアプリを停止してから開始してください。');
    if(items.some(i=>i.caption.length>2200))warnings.push('長いキャプションがあります。テキストエンコーダーの上限による切り詰めに注意してください。');
    if(this.engine.child)warnings.push('学習開始時に、このGUIが起動したGemmaを停止してVRAMを解放します。');
    this.plan={id,run,projectId:p.id,source:p.source,trigger,mode:p.settings.mode,config:c,ids:items.map(i=>i.id),fingerprint:await this.fingerprint(items),count:items.length,gpu,warnings,commands:trainingCommands(this.root,run,c,trigger)};
    await atomicWrite(path.join(run,'plan.json'),JSON.stringify(this.plan,null,2));return this.plan;
  }
  async start(id){
    if(this.active()||this.jobs.active())throw new Error('ほかの処理が実行中です');
    const p=this.plan;if(!p||p.id!==id)throw new Error('学習設定の検査をやり直してください');
    this.launching=true;
    try {
      const items=p.ids.map(id=>this.workspace.item(id));if(await this.fingerprint(items)!==p.fingerprint)throw new Error('検査後にデータセット・方針が変わりました。再検査してください');
      const dataset=path.join(p.run,'dataset');await fs.mkdir(dataset,{recursive:true});
      const manifest=[];
      for(let index=0;index<items.length;index++){
        const i=items[index],source=await this.workspace.imagePath(i.id),stem=String(index+1).padStart(6,'0'),name=stem+path.extname(source).toLowerCase();
        await fs.copyFile(source,path.join(dataset,name));await fs.writeFile(path.join(dataset,stem+'.txt'),i.caption.trim()+'\n');manifest.push({image:name,source:i.relative,caption:i.caption,trigger:p.trigger,reviewed:i.reviewed});
      }
      await atomicWrite(path.join(p.run,'captions.jsonl'),manifest.map(i=>JSON.stringify(i)).join('\n')+'\n');
      const quote=s=>JSON.stringify(s);
      await atomicWrite(path.join(p.run,'dataset.toml'),`[general]\nresolution = [${p.config.resolution}, ${p.config.resolution}]\ncaption_extension = ".txt"\nbatch_size = ${p.config.batchSize}\nenable_bucket = true\nbucket_no_upscale = true\n\n[[datasets]]\nimage_directory = ${quote(dataset)}\ncache_directory = ${quote(path.join(p.run,'cache'))}\nnum_repeats = 1\n`);
      await atomicWrite(path.join(p.run,'trigger.txt'),p.trigger+'\n');
      this.plan=null;this.logs=[];this.current={id,state:'running',phase:'準備',step:0,totalSteps:p.config.steps,run:p.run,trigger:p.trigger,startedAt:Date.now(),artifacts:[]};
      void this.run(p).catch(async e=>{this.current.state=this.current.state==='stopping'?'cancelled':'error';this.current.error=e.message;this.log(e.message);await atomicWrite(path.join(p.run,'result.json'),JSON.stringify(this.current,null,2));});return this.status();
    }finally{this.launching=false;}
  }
  log(text){this.logs.push(...text.replace(/\x1b\[[0-9;]*m/g,'').split(/[\r\n]+/).filter(Boolean));if(this.logs.length>300)this.logs.splice(0,this.logs.length-300);const all=[...text.matchAll(/(\d+)\/(\d+)\s*\[/g)];if(all.length&&this.current?.phase==='LoRA学習'){const m=all.at(-1);this.current.step=Number(m[1]);}}
  async run(p){
    if(this.engine.child){this.current.phase='GemmaのVRAMを解放';this.engine.stop();for(let i=0;i<100&&this.engine.child;i++)await new Promise(r=>setTimeout(r,100));if(this.engine.child)throw new Error('Gemmaの停止が完了していません');}
    for(const command of p.commands){
      if(this.current.state==='stopping')throw new Error('学習を停止しました');this.current.phase=command.name;
      await new Promise((resolve,reject)=>{
        const child=spawn(path.join(this.root,'runtime/python-run'),command.args,{cwd:path.join(this.root,'vendor/musubi-tuner'),detached:true,env:{...process.env,PYTHONUNBUFFERED:'1',CUDA_VISIBLE_DEVICES:'0',OMP_NUM_THREADS:'4',TOKENIZERS_PARALLELISM:'false'},stdio:['ignore','pipe','pipe']});this.child=child;
        const write=chunk=>{const text=chunk.toString();this.log(text);fs.appendFile(path.join(p.run,'train.log'),text).catch(()=>{});};
        child.stdout.on('data',write);child.stderr.on('data',write);child.on('error',reject);child.on('close',(code,signal)=>{this.child=null;code===0?resolve():reject(new Error(`${command.name}が終了しました (${code??signal})。ログを確認してください。`));});
      });
    }
    const output=path.join(p.run,'output'),files=await fs.readdir(output).catch(()=>[]);this.current.artifacts=files.filter(f=>f.endsWith('.safetensors')).map(f=>path.join(output,f));
    if(!this.current.artifacts.length)throw new Error('学習は終了しましたがLoRAファイルが見つかりません');
    await atomicWrite(path.join(output,'trigger.txt'),p.trigger+'\n');
    this.current.state='completed';this.current.finishedAt=Date.now();this.current.step=p.config.steps;await atomicWrite(path.join(p.run,'result.json'),JSON.stringify(this.current,null,2));
  }
  stop(){if(!this.active())return;this.current.state='stopping';const child=this.child;if(child){try{process.kill(-child.pid,'SIGINT');}catch{child.kill('SIGINT');}setTimeout(()=>{if(this.child===child){try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}},8000).unref();}}
}
