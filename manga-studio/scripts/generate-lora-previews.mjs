// Real GPU inference. Each invocation creates a fresh batch and preserves outputs.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {spawn} from 'node:child_process';
import {loadConfig,packageRoot} from '../src/config.js';
import {Store} from '../src/store.js';
import {LocalStudios} from '../src/local-studios.js';

if(!process.argv.includes('--run')){console.log('Use --run to generate a fresh preview for each registered LoRA. Requires GPU/RAM; uses the common GPU queue.');process.exit(0);}
const option=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
const selectedFamily=option('--family')||'all',promptTemplate=option('--prompt');
if(!['all','krea2','h3'].includes(selectedFamily)||promptTemplate&&promptTemplate.length>19000)throw Error('Invalid --family or --prompt');
const subprocess={spawn(spec){
  const child=spawn(spec.argv[0],spec.argv.slice(1),{cwd:spec.cwd,stdio:['ignore','pipe','pipe'],env:{...process.env,...spec.env}});let stdout='',stderr='';
  child.stdout.on('data',b=>stdout=(stdout+b).slice(-8000));child.stderr.on('data',b=>stderr=(stderr+b).slice(-8000));
  const stop=()=>child.kill('SIGTERM');spec.signal?.addEventListener('abort',stop,{once:true});
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',exitCode=>{spec.signal?.removeEventListener('abort',stop);resolve({exitCode});});});
  return {done,waitForExit:()=>done,collected:{stdout:{readFrom:()=>({text:stdout})},stderr:{readFrom:()=>({text:stderr})}}};
}};
const config=loadConfig(),store=new Store(config.dataDir),studios=new LocalStudios(config,store,subprocess);
const session='lora-previews-'+Date.now(),dir=join(config.dataDir,'.model-thumbnails',session);await mkdir(dir,{recursive:true});
const report={id:session,startedAt:new Date().toISOString(),results:[],errors:[],state:'running'};
const save=()=>writeFile(join(dir,'report.json'),JSON.stringify(report,null,2));
const signal=AbortSignal.timeout(4*60*60*1000);let current=null,provider;
const stop=new AbortController();for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>stop.abort());
const combined=AbortSignal.any([signal,stop.signal]);
try{
  const library=JSON.parse(await readFile(config.library,'utf8'));
  const items=library.items.filter(i=>i.kind==='lora'&&['krea2','h3'].includes(i.family)&&(selectedFamily==='all'||i.family===selectedFamily));report.total=items.length;
  for(const family of ['krea2','h3']){
    if(!items.some(i=>i.family===family))continue;
    provider=family==='krea2'?'krea':'h3';combined.throwIfAborted();
    let ready=await studios.control(provider,'start',combined);
    while(!ready.ready){await delay(3000,undefined,{signal:combined});ready=await studios.waitReady(provider,combined,30000);}
    await studios.models.catalog(provider,{refresh:true});
    for(const [index,item]of items.entries()){
      if(item.family!==family)continue;combined.throwIfAborted();
      const key=createHash('sha256').update(JSON.stringify([provider,'lora',item.loraId])).digest('hex').slice(0,32);
      const prompt=promptTemplate?promptTemplate.replaceAll('{trigger}',item.trigger||''):`${item.trigger||''}, A fully clothed adult woman in her thirties wearing a blue jacket and long trousers, standing in a sunlit courtyard with leafy trees and a wooden bench. Three-quarter view, clear face and hands, natural daylight, detailed illustration, calm everyday scene, no lettering.`+(family==='h3'?' She slowly raises one hand in a friendly wave. A gentle breeze moves the leaves. Stable camera, consistent appearance.':'');
      const args=family==='krea2'?{model_id:'krea2-turbo-official',preset:'turbo8',steps:8,width:768,height:768,seed:42,prompt,loras:[{id:item.loraId,weight:0.8,enabled:true}]}:
        {model:'MiniMax-H3',preset:'turbo8',steps:8,width:704,height:704,frames:124,seed:42,prompt,attention:'sage',memory_profile:'shared',loras:[{path:item.loraId,weight:0.8,enabled:true}],projectTitle:'LoRA参考サムネイル'};
      console.log(JSON.stringify({event:'start',index:index+1,total:items.length,provider,key}));
      const started=Date.now();let result;
      try{
        const submitted=await studios.generate(session,provider,args,combined);current=submitted.id;
        report.current={index:index+1,key,provider,id:current,remoteId:submitted.remoteId};await save();
        let lastLog=0;
        while(true){
          result=await studios.job(session,current,'status',combined);
          if(Date.now()-lastLog>15000){console.log(JSON.stringify({event:'progress',index:index+1,provider,status:result.job.status,progress:result.job.progress,phase:result.job.phase||result.job.stage,elapsedSeconds:Math.round((Date.now()-started)/1000)}));lastLog=Date.now();}
          if(['completed','failed','cancelled','interrupted'].includes(result.job.status))break;
          await delay(1000,undefined,{signal:combined});
        }
        if(result.job.status!=='completed'||!result.outputPath)throw Error(result.job.error||'No completed output');
        const request=studios.owned(session,current,'media').request;
        if(!request.loras.some(l=>(l.id||l.path)===item.loraId&&l.weight===0.8))throw Error('LoRA request mismatch');
        let metadata;
        if(provider==='krea'){
          metadata=await studios.request(provider,result.job.result.metadata_url,{signal:combined});
          if(!metadata.loras.some(l=>l.id===item.loraId&&l.weight===0.8))throw Error('Output LoRA metadata mismatch');
        }else{
          metadata=result.job;
          if(!result.job.resolved?.loras?.some(l=>l.path===item.loraId&&l.weight===0.8))throw Error('H3 output settings mismatch');
        }
        await writeFile(join(dir,key+'-metadata.json'),JSON.stringify(metadata,null,2));
        const thumbnail=await studios.models.thumbnailFromFile(key,result.outputPath,{kind:'generated'});
        const provenance={jobId:current,remoteId:submitted.remoteId,provider,model:args.model_id||args.model,loraId:item.loraId,weight:0.8,seed:42,output:result.outputPath,metadata:join(dir,key+'-metadata.json')};
        store.db.prepare('UPDATE model_thumbnails SET body=? WHERE key=?').run(JSON.stringify({...thumbnail,provenance}),key);
        report.results.push({key,...provenance,seconds:(Date.now()-started)/1000});
        console.log(JSON.stringify({event:'completed',completed:report.results.length,total:items.length,provider,seconds:(Date.now()-started)/1000}));
      }catch(error){
        report.errors.push({key,provider,message:String(error.message).slice(0,2000)});
        console.log(JSON.stringify({event:'failed',index:index+1,provider,key,error:String(error.message).slice(0,300)}));
        if(current&&result?.job?.status!=='completed')await studios.job(session,current,'cancel',AbortSignal.timeout(10000)).catch(()=>{});
        if(combined.aborted)throw error;
      }finally{current=null;delete report.current;await save();}
    }
  }
  report.state=report.errors.length?'completed_with_errors':'completed';
}catch(error){report.state='failed';report.error=String(error.message).slice(0,2000);throw error;}
finally{
  if(current)await studios.job(session,current,'cancel',AbortSignal.timeout(10000)).catch(()=>{});
  report.finishedAt=new Date().toISOString();await save();store.close();
}
