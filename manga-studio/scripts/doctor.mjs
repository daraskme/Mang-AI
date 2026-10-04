import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';

const config=loadConfig();let failed=false;
for(const role of ['gemma','qwen']){
  const c=config[role];
  try {
    const key=process.env[role==='qwen'?'MANGA_QWEN_API_KEY':c.apiKeyEnv];
    const response=await fetch(`${c.baseURL}/models`,{headers:key?{Authorization:`Bearer ${key}`}:{},signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const result=await response.json(),ids=(result.data||[]).map(m=>m.id);
    if(!ids.includes(c.model))throw new Error(`設定モデルがありません。利用可能な ID: ${ids.join(', ')}`);
    console.log(`OK ${role}: ${c.model}`);
  } catch(error){failed=true;console.log(`NG ${role}: ${c.baseURL} — ${error.message}`);}
}
if(config.krea.backend!=='studio')for(const [label,path] of [['Krea official inference',join(config.krea.repo,'inference.py')],['Krea Python',config.krea.python],['Krea weights',config.krea.weights]]){
  try{if(!path)throw new Error('未設定');await access(path);console.log(`OK ${label}: ${path}`);}
  catch(error){failed=true;console.log(`NG ${label}: ${path||'未設定'} — ${error.code||error.message}`);}
}
for(const [role,endpoint] of [['krea','/health'],['h3','/api/status'],['caption','/']]) {
  if(!config[role]?.baseURL)continue;
  try {
    const response=await fetch(config[role].baseURL+endpoint,{signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    console.log(`OK ${role} Studio: ${config[role].baseURL}`);
  }catch(error){failed=true;console.log(`NG ${role} Studio: ${error.message} — media_service で起動できます`);}
}
for(const [label,path] of [['編集用Python',config.editing.python],['IOPaint橋渡し',join(import.meta.dirname,'../python/edit_media.py')],['mosaic_editor',join(config.editing.mosaicRepo,'mosaic_editor/core/masking.py')]]){
  try{await access(path);console.log(`OK ${label}: ${path}`);}catch(error){failed=true;console.log(`NG ${label}: ${error.message}`);}
}
console.log('接続・配置検査のみ。モデルのロード・画像生成は行っていません。');
process.exitCode=failed?1:0;
