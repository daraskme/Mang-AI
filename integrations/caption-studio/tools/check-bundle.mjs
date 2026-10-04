import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
const pairs=[
['models/caption/UNSEEN_Gemma_4_26B_NSFW_Q4_K_M.gguf','/run/media/hiroshi/ボリューム/krea2/models/caption/UNSEEN_Gemma_4_26B_NSFW_Q4_K_M.gguf'],
['models/caption/mmproj-gemma4-vision-f16.gguf','/run/media/hiroshi/ボリューム/krea2/models/caption/mmproj-gemma4-vision-f16.gguf'],
['models/krea2/krea2_raw_bf16.safetensors','/run/media/hiroshi/ボリューム/krea2/models/krea2/diffusion_models/krea2_raw_bf16.safetensors'],
['models/krea2/qwen_image_vae.safetensors','/run/media/hiroshi/ボリューム/krea2/models/krea2/qwen_image_vae.safetensors'],
['models/krea2/qwen3_vl_4b.safetensors','/home/hiroshi/プロジェクト/krea2-darask/models/krea2-turbo-diffusers/text_encoder/model.safetensors']];
const hash=async f=>{const h=createHash('sha256');for await(const chunk of createReadStream(f))h.update(chunk);return h.digest('hex');};const output=[];
for(const [local,source] of pairs){const [a,b]=await Promise.all([hash(local),hash(source)]);if(a!==b)throw new Error(local+' hash mismatch');output.push({file:local,size:(await fs.stat(local)).size,sha256:a});console.log('Verified '+local);}
await fs.writeFile('models/manifest.json',JSON.stringify(output,null,2));
