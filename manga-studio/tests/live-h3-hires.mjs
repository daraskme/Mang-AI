import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {MangaService} from '../src/service.js';
import {loadConfig} from '../src/config.js';
import {nativeSubprocess} from './native-subprocess.mjs';
const c=loadConfig();c.dataDir='.test-output/native-h3-shared';
const service=new MangaService(c,nativeSubprocess),signal=AbortSignal.timeout(1200000);
try{
  await service.studios.control('h3','start',signal);await delay(3000);
  const submitted=await service.studios.generate('native-h3-shared','h3',{model:'MiniMax-H3-Eros-Max-beta5-INT8',memory_profile:'shared',prompt:'A small red sailboat on a calm lake at dawn. The sail gently moves. Watercolor illustration, a slow steady camera. Quiet water ambience.',width:768,height:448,frames:124,seed:42,preset:'turbo8',latent_refine:{enabled:true,model:'minimax_h3_latent_upscaler_3d_conv_v1_bf16.safetensors',scale:1.5,strength:0.18,steps:4}},signal);
  console.log('Submitted',submitted.id);let previous='';
  while(true){const result=await service.studios.job('native-h3-shared',submitted.id,'status',signal),status=result.job.phase||result.job.status;if(status!==previous){console.log(status);previous=status;}if(['completed','failed','cancelled','interrupted'].includes(result.job.status)){await writeFile('.test-output/native-h3-shared/result.json',JSON.stringify(result,null,2));assert.equal(result.job.status,'completed',result.job.error);console.log('PASS native H3 shared + latent Hires',result.outputUrl);break;}await delay(2000,undefined,{signal});}
}finally{await service.close();}
