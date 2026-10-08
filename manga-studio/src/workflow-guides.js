import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packageRoot } from './config.js';

const guides={
  image:{file:'image-production-policy.md',sections:['overview','prepare','prompt','generate','review','save','gpu']},
  video:{file:'video-production-policy.md',sections:['overview','prepare','prompt','generate','review','save','gpu']},
  lora:{file:'lora-production-policy.md',sections:['overview','prepare','collect','caption','train','review','save','gpu']},
};

/** Return one stage at a time so the resident 4B agent keeps a small working context. */
export async function workflowGuide({workflow,section='overview'}) {
  const guide=Object.hasOwn(guides,workflow)?guides[workflow]:null;
  if(!guide)throw Error('workflow は image、video、lora です');
  if(!guide.sections.includes(section))throw Error(`${workflow} の section は ${guide.sections.join(', ')} です`);
  const document=await readFile(join(packageRoot,'docs',guide.file),'utf8');
  const policy=document.split(/\n(?=## )/).find(part=>part.startsWith(`## ${section} — `));
  if(!policy?.trim())throw Error(`制作手順の ${workflow}/${section} が見つかりません`);
  return {workflow,section,policy:policy.trim(),source:`manga-studio/docs/${guide.file}`,sections:guide.sections};
}

export function registerWorkflowGuides(register) {
  register('media_workflow_guide','単独画像・動画・LoRA制作の手順を一工程ずつ読む。着手時はoverview、次に必要なsection。LoRAは素材収集→UNSEEN Gemmaのキャプション→学習→評価。H3新規学習の未統合範囲も確認する。',{
    workflow:{type:'string',enum:Object.keys(guides),required:true},
    section:{type:'string',enum:[...new Set(Object.values(guides).flatMap(g=>g.sections))],description:'省略時overview。画像/動画はprepare,prompt,generate,review,save,gpu。LoRAはprepare,collect,caption,train,review,save,gpu'},
  },workflowGuide);
}
