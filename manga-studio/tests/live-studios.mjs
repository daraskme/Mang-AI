// Explicit opt-in smoke test: uses installed models, never runs under npm test.
import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile,copyFile,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { loadConfig,packageRoot } from '../src/config.js';
import { Store } from '../src/store.js';
import { LocalStudios } from '../src/local-studios.js';

const phase=process.argv[2];
assert(['krea','caption','h3'].includes(phase),'Pass krea, caption, or h3 explicitly.');
const root=join(packageRoot,'.test-output','live-'+phase+'-'+Date.now());await mkdir(root,{recursive:true});
const config=loadConfig(),store=new Store(root);
const subprocess={spawn(spec){
  let stderr='';const p=spawn(spec.argv[0],spec.argv.slice(1),{stdio:['ignore','pipe','pipe'],signal:spec.signal});
  p.stderr.on('data',b=>stderr+=b);
  const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('exit',exitCode=>resolve({exitCode}));});
  return {done,waitForExit:()=>done,collected:{stderr:{readFrom:()=>({text:stderr})}}};
}};
const studios=new LocalStudios(config,store,subprocess),session='live-test',signal=AbortSignal.timeout(1200000);
async function until(fn,done) {let previous='';while(true){signal.throwIfAborted();const value=await fn();const label=value.phase||value.job?.status||value.job?.state||value.health||value.state;if(label!==previous){console.log(label);previous=label;}if(done(value))return value;await delay(1000,undefined,{signal});}}
try {
  if(phase==='krea'||phase==='h3') {
    await studios.control(phase,'start',signal);await delay(3000);
    const args=phase==='krea'?{prompt:'A simple blue ceramic vase on a wooden table, three yellow flowers, soft window light, plain cream wall. Hand-drawn illustration. No writing.',width:512,height:512,steps:8,seed:42}:{prompt:'A blue ceramic vase with yellow flowers on a wooden table. Gentle movement of petals in a breeze. Fixed camera, quiet room ambience.',width:256,height:256,frames:124,steps:1,seed:42};
    const submitted=await studios.generate(session,phase,args,signal);console.log('Submitted '+submitted.id);
    const result=await until(()=>studios.job(session,submitted.id,'status',signal),v=>['completed','failed','cancelled'].includes(v.job.status));
    await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));
    assert.equal(result.job.status,'completed',JSON.stringify(result.job.error));
    console.log('PASS '+phase+': '+result.outputUrl);
    await studios.control(phase,'stop',signal);
    if(phase==='krea')await studios.control('krea','start',signal);
  } else {
    await studios.control('krea','stop',signal);
    const dataset=join(root,'dataset');await mkdir(dataset);
    const fixtures=join(packageRoot,'../caption-studio/examples/demo');
    for(const name of await readdir(fixtures))if(name.endsWith('.png'))await copyFile(join(fixtures,name),join(dataset,name));
    await studios.captionOpen(session,{folder:dataset,settings:{mode:'concept',trigger:'migration_vase',concept:'a ceramic flower vase',learn:'',language:'en',length:'short'}},signal);
    const started=await studios.captionAction(session,'generate',{},signal);
    if(started.state==='loading') {
      await until(()=>studios.request('caption','/api/engine/status',{signal}),v=>{if(v.health==='offline'&&!v.managed)throw new Error(v.logs?.join('\n'));return v.health==='ready';});
      await studios.captionAction(session,'generate',{},signal);
    }
    const captions=await until(()=>studios.captionStatus(session,{},signal),v=>['completed','error','cancelled'].includes(v.job?.state));
    assert.equal(captions.job.state,'completed');assert.equal(captions.job.failed,0,JSON.stringify(captions.job.errors));
    assert.equal((await studios.captionAction(session,'save',{},signal)).written,3);
    await writeFile(join(root,'captions.json'),JSON.stringify(captions,null,2));console.log('PASS vision captions and .txt save');
    const prepared=await studios.prepareTraining(session,{config:{resolution:256,steps:1,saveEvery:1,rank:4,alpha:4,fp8:true,blocksToSwap:0}},signal);
    console.log('Training '+prepared.plan.run);await studios.training(session,prepared.id,'start',signal);
    const trained=await until(()=>studios.training(session,prepared.id,'status',signal),v=>['completed','error','cancelled'].includes(v.state));
    await writeFile(join(root,'training.json'),JSON.stringify(trained,null,2));assert.equal(trained.state,'completed',JSON.stringify(trained));
    const installed=await studios.installLora(session,{id:prepared.id,name:'migration-smoke-'+Date.now()},signal);
    await writeFile(join(root,'installed.json'),JSON.stringify(installed,null,2));console.log('PASS LoRA training and install: '+installed.path);
    await studios.control('krea','start',signal);
  }
}finally{store.close();console.log('Artifacts: '+root);}
