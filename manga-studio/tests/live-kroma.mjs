// Explicit manual test. Notify the user before running: loads ~35–45 GB into VRAM.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {loadConfig,packageRoot} from '../src/config.js';
import {Store} from '../src/store.js';
import {LocalStudios} from '../src/local-studios.js';

const root=join(packageRoot,'.test-output','kroma-live-'+Date.now());await mkdir(root,{recursive:true});
const config=loadConfig(),store=new Store(root),studios=new LocalStudios(config,store,{});
const session='kroma-live',signal=AbortSignal.timeout(1200000);
async function complete(id,name) {
  let previous='';
  while(true) {
    signal.throwIfAborted();
    const result=await studios.job(session,id,'status',signal);
    const stage=result.job.stage||result.job.status;
    if(stage!==previous){console.log(name,stage);previous=stage;}
    if(['completed','failed','cancelled'].includes(result.job.status)) {
      await writeFile(join(root,name+'.json'),JSON.stringify(result,null,2));
      assert.equal(result.job.status,'completed',JSON.stringify(result.job));
      return result;
    }
    await delay(1500,undefined,{signal});
  }
}
try {
  const status=await studios.status('krea',signal);
  assert(status.models.items.some(m=>m.id==='kroma-v03-turbo'&&m.available));
  const loras=process.env.TEST_STYLE_LORA==='1'?[{id:'user/style/krea2_manga_style.safetensors',weight:0.6,enabled:true}]:[];
  const submitted=await studios.generate(session,'krea',{
    model_id:'kroma-v03-turbo',preset:'turbo8',steps:8,width:512,height:512,seed:42,loras,
    prompt:'A blue ceramic teapot beside three yellow flowers on a wooden table near a sunny window. Hand-drawn manga illustration, precise outlines, soft colors, no people, no lettering or text.',
  },signal);
  const base=await complete(submitted.id,'base');
  const hiresJob=await studios.upscale(session,{id:submitted.id,scale:1.5,refine_steps:4,denoise_strength:0.25},signal);
  const hires=await complete(hiresJob.id,'hires');
  for(const [result,size] of [[base,512],[hires,768]]) {
    const png=await readFile(result.outputPath);
    assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);
    const metadata=await studios.request('krea',result.job.result.metadata_url,{signal});
    assert.equal(metadata.model.id,'kroma-v03-turbo');
    await writeFile(join(root,size+'-metadata.json'),JSON.stringify(metadata,null,2));
  }
  console.log('PASS Kroma 512px generation → 768px Hires; artifacts:',root);
  console.log('Final PNG:',hires.outputPath);
} finally {store.close();}
