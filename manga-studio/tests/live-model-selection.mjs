// Opt-in real inference. Notify the user before running: loads tens of GiB into GPU/RAM.
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {execFileSync} from 'node:child_process';
import {loadConfig, packageRoot} from '../src/config.js';
import {Store} from '../src/store.js';
import {LocalStudios} from '../src/local-studios.js';
import {nativeSubprocess} from './native-subprocess.mjs';

assert(process.argv.includes('--run'), 'Explicit --run is required; this test uses the GPU.');
const trainedIndex=process.argv.indexOf('--trained-lora');
const trained=trainedIndex<0?null:process.argv[trainedIndex+1];
if(trainedIndex>=0)assert(trained&&!trained.startsWith('--'), '--trained-lora requires the catalog ID.');
const root=join(packageRoot,'.test-output','model-selection-'+Date.now());
await mkdir(root,{recursive:true});
const config=loadConfig(), store=new Store(root), studios=new LocalStudios(config,store,nativeSubprocess);
const session='selection-check', signal=AbortSignal.timeout(1800000);
const prompt='A clean full-color manga-style still life on a wooden desk against a plain cream wall. Exactly one red ceramic mug stands on the LEFT. Exactly one closed blue book lies flat on the RIGHT, separate from the mug. Both objects are fully visible. Soft daylight from a window on the left, eye-level three-quarter view, neat black outlines, simple background. No people, no flowers, no other objects, no writing, no letters, no logos.';
const style={id:'user/style/krea2_manga_style.safetensors',weight:0.6,role:'style'};
const cases=[
  {name:'kroma-no-lora',model:'kroma-v03-turbo',loras:[]},
  {name:'kroma-manga',model:'kroma-v03-turbo',loras:[style]},
  {name:'muse-manga',model:'muse-v35',loras:[style]},
  {name:'moody-manga',model:'moody-v8',loras:[style]},
  {name:'redcraft-manga',model:'redcraft-v3',loras:[style]},
  {name:'official-manga',model:'krea2-turbo-official',loras:[style]},
  ...(trained?[{name:'official-new-lora',model:'krea2-turbo-official',loras:[{id:trained,weight:0.8,role:'other'}],prompt:'migration_vase. A simple blue ceramic vase containing three yellow flowers on a wooden table, plain cream wall, soft daylight, full-color illustration. No people, no text.'}]:[]),
];
const report={root,prompt,settings:{seed:42,width:512,height:512,steps:8,preset:'turbo8'},results:[],semanticReview:'pending'};
let current=null, initial=null;
async function save(name,value){await writeFile(join(root,name+'.json'),JSON.stringify(value,null,2)+'\n');}
async function a1(){
  const r=await fetch('http://127.0.0.1:1240/health',{signal:AbortSignal.timeout(3000)});
  assert(r.ok,'Resident A1 must remain healthy');
  return {healthy:true,pid:execFileSync('systemctl',['--user','show','mang-ai-agent.service','--property=MainPID','--value'],{encoding:'utf8',timeout:5000}).trim()};
}
try{
  initial=await studios.request('krea','/api/state',{signal});
  assert.equal(initial.active_job_id,null,'Do not interrupt an existing generation');
  assert.equal(initial.queue_length,0);
  assert.equal(initial.loaded_model_id,null,'Start this test with Krea unloaded');
  report.a1Before=await a1();
  const catalog=await studios.models.catalog('krea',{refresh:true});
  assert(!catalog.error,catalog.error);await save('catalog',catalog);
  for(const item of cases){
    // Exercise the same saved per-session selection used by GUI and agent tools.
    await studios.models.select(session,{provider:'krea',model:item.model,loras:item.loras});
    const chosen=studios.models.selected(session,'krea');
    await save(item.name+'-selection',chosen);
    const expectedPrompt=item.prompt||prompt;
    const submitted=await studios.generate(session,'krea',{...report.settings,prompt:expectedPrompt},signal);
    current=submitted.id;
    const submittedRequest=studios.owned(session,current,'media').request;
    assert.equal(submittedRequest.model_id,item.model);
    assert.deepEqual(submittedRequest.loras.map(({id,weight})=>({id,weight})),item.loras.map(({id,weight})=>({id,weight})));
    console.log(JSON.stringify({event:'submitted',case:item.name,id:current}));
    let result,previous='',observedRuntime=null;
    while(true){
      result=await studios.job(session,current,'status',signal);
      const phase=result.job.stage||result.job.status;
      if(phase!==previous){console.log(JSON.stringify({event:'progress',case:item.name,phase}));previous=phase;}
      if(['completed','failed','cancelled','interrupted'].includes(result.job.status))break;
      if(phase==='base'){
        const state=await studios.request('krea','/api/state',{signal});
        if(state.active_job_id===submitted.remoteId&&state.loaded_model_id===item.model)observedRuntime=state;
      }
      await delay(200,undefined,{signal});
    }
    await save(item.name+'-result',result);
    assert.equal(result.job.status,'completed',JSON.stringify(result.job.error));
    current=null;
    const metadata=await studios.request('krea',result.job.result.metadata_url,{signal});
    // Managed jobs release their GPU weights before marking the job completed.
    const runtime=observedRuntime;
    const expectedLoras=item.loras.map(({id,weight})=>({id,weight}));
    assert.equal(metadata.model.id,item.model);
    assert.equal(metadata.prompt,expectedPrompt);
    assert.equal(metadata.seed,42);
    assert.deepEqual(metadata.loras,expectedLoras);
    assert.deepEqual(metadata.passes[0].loras,expectedLoras);
    assert(runtime,'Observe the selected pipeline while sampling, before automatic GPU release');
    assert.equal(runtime.loaded_model_id,item.model);
    assert.deepEqual(runtime.loaded_loras.map(({id,weight})=>({id,weight})),expectedLoras);
    const bytes=await readFile(result.outputPath);
    assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
    assert.equal(bytes.readUInt32BE(16),512);assert.equal(bytes.readUInt32BE(20),512);
    const resident=await a1();assert.equal(resident.pid,report.a1Before.pid);
    await save(item.name+'-metadata',metadata);await save(item.name+'-runtime',runtime);
    report.results.push({name:item.name,model:item.model,loras:expectedLoras,outputPath:result.outputPath,seconds:metadata.elapsed_seconds,totalSeconds:result.job.result.total_seconds,performance:metadata.performance,a1:resident});
    await save('report',report);
    console.log(JSON.stringify({event:'passed',case:item.name,outputPath:result.outputPath,seconds:metadata.elapsed_seconds}));
  }
  report.selectionChecksPassed=true;
}catch(error){report.error=error.message;throw error;}
finally{
  if(current){
    await studios.job(session,current,'cancel',AbortSignal.timeout(10000)).catch(e=>report.cancelError=e.message);
    for(let i=0;i<30;i++){
      const r=await studios.job(session,current,'status',AbortSignal.timeout(5000)).catch(()=>null);
      if(!r||['completed','failed','cancelled','interrupted'].includes(r.job.status))break;
      await delay(1000);
    }
  }
  if(initial&&!initial.loaded_model_id&&!initial.active_job_id&&initial.queue_length===0){
    // control() refuses to stop if any other job has become active.
    try{
      await studios.control('krea','stop',AbortSignal.timeout(30000));
      await studios.control('krea','start',AbortSignal.timeout(60000));
      report.unloaded=(await studios.request('krea','/api/state')).loaded_model_id===null;
    }catch(e){report.cleanupError=e.message;}
  }
  report.a1After=await a1().catch(e=>({healthy:false,error:e.message}));
  report.a1PidUnchanged=report.a1After.pid===report.a1Before?.pid;
  await save('report',report);store.close();
  console.log('Artifacts: '+root);
}
