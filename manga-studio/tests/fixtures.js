import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { packageRoot, loadConfig } from '../src/config.js';

export async function tempRoot(name='case') {
  const base=join(packageRoot,'.test-output');await mkdir(base,{recursive:true});return mkdtemp(join(base,name+'-'));
}
export function config(root) {const c=loadConfig();c.dataDir=root;c.editorPort=0;c.krea.backend='python';return c;}
export const script={pages:[{layout:'上大＋下2',purpose:'雨上がりの駅で、手紙を渡す。',panels:[
  {action:'ホームで手紙を差し出す。',artPrompt:'A woman in a navy coat offers a folded letter at a quiet train platform after the rain.',dialogue:[{speaker:'紗季',text:'これ、あなたに。'}]},
  {action:'受け取った封筒を見る。',artPrompt:'Close-up of a man in a tan jacket looking down at a folded letter in his hands.',dialogue:[{speaker:'悠',text:'今、読んでもいい？'}]},
  {action:'一歩下がって待つ。',artPrompt:'The woman in a navy coat takes a step back and waits, soft evening light on a train platform.',dialogue:[{speaker:'紗季',text:'電車が来るまでなら。'}]},
]}]};
export const bubble={id:'b-test',speaker:'紗季',text:'これ、あなたに。',kind:'speech',direction:'vertical',x:720,y:70,width:180,height:300,fontSize:30,tailX:700,tailY:420};
export const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
