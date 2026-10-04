import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {packageRoot} from '../src/config.js';
const lock=JSON.parse(await readFile(resolve(packageRoot,'node_modules/@deepseek-ai/dsh-experimental-speech-to-text-sensevoice/runtime/assets.json'),'utf8'));
for(const [asset,folder] of [[lock.models.int8,'sensevoice-onnx'],[lock.tokens,'sensevoice-onnx'],[lock.vad,'silero']]){
  const file=resolve(packageRoot,'../models/speech/models',folder,asset.name);
  const valid=b=>b.length===asset.bytes&&createHash('sha256').update(b).digest('hex')===asset.sha256;
  let bytes;try{bytes=await readFile(file);}catch{}
  if(!bytes||!valid(bytes)){
    const response=await fetch(asset.url,{signal:AbortSignal.timeout(600000)});if(!response.ok)throw Error(`HTTP ${response.status}`);
    bytes=Buffer.from(await response.arrayBuffer());if(!valid(bytes))throw Error(`Checksum mismatch ${asset.name}`);
    await mkdir(dirname(file),{recursive:true});await writeFile(file+'.partial',bytes);await rename(file+'.partial',file);
  }
  console.log(`Verified ${asset.name}`);
}
