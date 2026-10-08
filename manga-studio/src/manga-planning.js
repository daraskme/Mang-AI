import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {packageRoot} from './config.js';
import {LAYOUTS, normalizeScript, replaceScript, text} from './model.js';

const list=(value,label,min=1,max=100)=>{
  if(!Array.isArray(value)||value.length<min||value.length>max)throw Error(`${label}: ${min}〜${max}件が必要です`);
  return value;
};
const records=(rows,label)=>{
  list(rows,label);const ids=new Set();
  for(const row of rows){if(!row||!/^[-a-zA-Z0-9_]{1,80}$/.test(row.id)||ids.has(row.id))throw Error(`${label}: 固有のIDが必要です`);ids.add(row.id);}
  return ids;
};
function refers(id,ids,label){if(!ids.has(id))throw Error(`${label}: 未登録ID ${id}`);}

export function validatePlan(stage,value,project,pageId) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('工程の出力はJSONオブジェクトが必要です');
  if(JSON.stringify(value).length>200000)throw Error('工程の出力が大きすぎます');
  if(stage==='settings'){
    text(value.summary,'全体の流れ',12000);
    const characters=records(value.characters,'人物'),locations=records(value.locations,'場所'),scenes=records(value.scenes,'場面');
    for(const c of value.characters){text(c.name,'人物名',120);text(c.appearance,'外見・衣装',3000);text(c.voice,'話し方',1500);}
    for(const loc of value.locations){text(loc.name,'場所名',120);text(loc.description,'背景の固定情報',4000);for(const link of list(loc.connectsTo??[],'隣接場所',0))refers(link,locations,'隣接場所');}
    for(const scene of value.scenes){refers(scene.locationId,locations,'場面の場所');for(const id of list(scene.characterIds,'登場人物',0))refers(id,characters,'場面の人物');text(scene.before,'開始状態',4000);text(scene.action,'行動',4000);text(scene.after,'終了状態',4000);}
    return structuredClone(value);
  }
  const plan=project.production;
  if(!plan?.settings)throw Error('先に manga_plan(stage:settings) で設定を保存してください');
  const sceneIds=new Set(plan.settings.scenes.map(s=>s.id));
  if(stage==='pages'){
    list(value.pages,'ページ',1,32);text(value.rationale,'ページ配分の理由',4000);
    let previous;
    value.pages.forEach((page,i)=>{
      if(page.id!==`p${i+1}`)throw Error('ページIDはp1から順に指定してください');
      if(!LAYOUTS[page.layout]||page.layout===previous)throw Error('ページのレイアウトが不正、または隣接ページと同じです');previous=page.layout;
      text(page.purpose,'ページの役割',1000);text(page.before,'ページ開始状態',3000);text(page.after,'ページ終了状態',3000);
      const count=LAYOUTS[page.layout].length;list(page.panels,'コマ',count,count);
      page.panels.forEach(panel=>{refers(panel.sceneId,sceneIds,'コマの場面');text(panel.action,'コマの行動',3000);text(panel.composition,'構図・余白',3000);});
    });
    return structuredClone(value);
  }
  if(stage!=='prompts')throw Error('stageはsettings / pages / promptsです');
  const planned=plan.pages?.pages.find(p=>p.id===pageId);
  if(!planned)throw Error('先にページ配分を保存し、そのページIDを指定してください');
  if(value.pageId!==pageId||value.layout!==planned.layout)throw Error('プロンプトのページID・レイアウトがページ配分と一致しません');
  text(value.pageBrief,'ページ全体の作画ブリーフ',6000);
  const normalized=normalizeScript({pages:[value]})[0];
  normalized.id=pageId;
  const characters=new Set(plan.settings.characters.map(c=>c.id));
  value.panels.forEach((panel,i)=>{
    if(panel.sceneId!==planned.panels[i].sceneId)throw Error('プロンプトの場面がページ配分と一致しません');
    const scene=plan.settings.scenes.find(s=>s.id===panel.sceneId);
    if(panel.locationId!==scene.locationId)throw Error('プロンプトの場所が場面設定と一致しません');
    for(const id of list(panel.characterIds,'コマの人物',0))refers(id,characters,'コマの人物');
    text(panel.continuity,'人物・背景・小物の引継ぎ',4000);
    normalized.panels[i].id=`${pageId}-c${i+1}`;
  });
  return {...structuredClone(value),normalized};
}

export function applyPlan(project,stage,value,{pageId,instruction,trace}) {
  const current=project.production??{version:1};
  const record={instruction,trace,at:new Date().toISOString(),revision:project.revision+1};
  if(stage==='settings'){
    project.production={...current,settings:value,settingsRecord:record,pages:null,prompts:{}};
  }else if(stage==='pages'){
    project.production={...current,pages:value,pagesRecord:record,prompts:{}};
  }else{
    const {normalized,...prompt}=value;
    const pages=project.pages.filter(p=>p.id!==pageId).concat(normalized).sort((a,b)=>Number(a.id.slice(1))-Number(b.id.slice(1)));
    replaceScript(project,pages);
    project.production={...current,prompts:{...current.prompts,[pageId]:{...prompt,record}}};
  }
  project.approved=null;
}

export function planningContext(project,stage,pageId) {
  const p=project.production;
  if(stage==='settings')return {title:project.title,brief:project.brief,characters:project.characters,style:project.style,selection:project.generationSelection,previous:p?.settings};
  if(!p?.settings)throw Error('先に設定を保存してください');
  if(stage==='pages')return {title:project.title,brief:project.brief,settings:p.settings,previous:p.pages};
  if(stage!=='prompts')throw Error('stageが不正です');
  const page=p.pages?.pages.find(x=>x.id===pageId);if(!page)throw Error('ページ配分にあるpageIdが必要です');
  const scenes=p.settings.scenes.filter(s=>page.panels.some(panel=>panel.sceneId===s.id));
  const chars=new Set(scenes.flatMap(s=>s.characterIds)),locations=new Set(scenes.map(s=>s.locationId));
  const index=p.pages.pages.indexOf(page);
  return {title:project.title,style:project.style,selection:project.generationSelection,characters:p.settings.characters.filter(c=>chars.has(c.id)),locations:p.settings.locations.filter(l=>locations.has(l.id)),scenes,page,previousPage:p.pages.pages[index-1],nextPage:p.pages.pages[index+1],existingPrompt:p.prompts?.[pageId]};
}

export function visualContinuity(project,page,panel){
  const production=project.production,planned=production?.prompts?.[page.id]?.panels[page.panels.findIndex(p=>p.id===panel.id)];
  if(!planned||!production.settings)return '';
  const characters=production.settings.characters.filter(c=>planned.characterIds.includes(c.id));
  const location=production.settings.locations.find(l=>l.id===planned.locationId);
  return [
    'Fixed reference descriptions for this single panel. Preserve each named character\'s appearance, clothes and belongings:',
    ...characters.map(c=>`${c.id} (${c.name}): ${c.visualDescription||c.appearance}`),
    ...(location?[`Fixed location ${location.id} (${location.name}): ${location.visualDescription||location.description}`]:[]),
    `Continuity for this moment: ${planned.continuity}`,
  ].join('\n');
}

export async function writePlan(project,config,{stage,instruction,pageId},signal) {
  const context=planningContext(project,stage,pageId);
  const policy=await readFile(join(packageRoot,'docs/manga-production-policy.md'),'utf8');
  const section={settings:'1.',pages:'2.',prompts:'3.'}[stage];
  const rules=policy.split(/\n(?=## )/).filter(p=>p.startsWith('## 役割')||p.startsWith(`## ${section}`)).join('\n');
  const shapes={
    settings:{summary:'全体の流れ',characters:[{id:'person1',name:'名前',appearance:'外見・衣装・持ち物',visualDescription:'The same fixed appearance, clothes and belongings in concise English. Used verbatim in every relevant image request.',voice:'口調・相手との関係'}],locations:[{id:'living',name:'リビング',description:'固定の家具・窓・光',visualDescription:'Concise English visual description of the fixed room.',connectsTo:['hall']},{id:'hall',name:'玄関',description:'扉・内外の位置',visualDescription:'Concise English visual description of the fixed entrance.',connectsTo:['living']}],scenes:[{id:'scene1',locationId:'living',characterIds:['person1'],before:'開始状態',action:'見える行動',after:'終了状態'}],proposals:['未確定の補完案']},
    pages:{rationale:'このページ数と配分にする理由',pages:[{id:'p1',layout:'縦2（上大）',purpose:'ページの役割',before:'開始状態',after:'終了状態',panels:[{sceneId:'scene1',action:'1時点の行動',composition:'構図と文字用余白'},{sceneId:'scene1',action:'次の瞬間',composition:'構図と文字用余白'}]}]},
    prompts:{pageId,layout:'計画のlayout',purpose:'ページの役割',pageBrief:'ページ全体の英語作画ブリーフ',panels:[{sceneId:'計画の場面ID',locationId:'場面の場所ID',characterIds:['人物ID'],continuity:'前後コマとつながる衣装・位置・小物',action:'1時点の見える行動',artPrompt:'Detailed English visual description; reserve clear tall areas for empty balloons according to dialogue count and speakers, away from faces. No lettering or written words. The rendering tool supplies the balloon mode and positions.',dialogue:[{speaker:'話者',text:'日本語の台詞'}]}]},
  };
  let dialogue='';
  if(stage==='prompts'){
    const guidelines=await readFile(join(packageRoot,'../guidelines/02-narrative-craft.md'),'utf8');
    dialogue=guidelines.split('### 4-10.')[1]?.split('\n## 5.')[0];
    if(!dialogue)throw Error('台詞規約 §4-10 が見つかりません');
  }
  const messages=[{role:'system',content:`あなたは日本語漫画の制作担当Gemmaです。司令塔の指示と保存済み設定を使い、今回の工程だけを制作してください。JSONだけを返します。${rules}\n${dialogue}\n出力形式（配列件数は依頼と計画に合わせる）:${JSON.stringify(shapes[stage])}\n使用可能なlayoutと必要コマ数:${JSON.stringify(Object.fromEntries(Object.entries(LAYOUTS).map(([k,v])=>[k,v.length])))}`},{role:'user',content:JSON.stringify({stage,instruction,...context})}];
  const key=process.env[config.apiKeyEnv],headers={'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})};
  const response=await fetch(`${config.baseURL}/chat/completions`,{method:'POST',headers,signal:AbortSignal.any([signal,AbortSignal.timeout(config.timeoutMs)]),body:JSON.stringify({model:config.model,messages,stream:false,temperature:config.temperature,max_tokens:config.maxTokens})});
  if(!response.ok)throw Error(`Gemma API: HTTP ${response.status}`);
  const choice=(await response.json()).choices?.[0];
  if(choice?.finish_reason==='length')throw Error('Gemmaの出力が上限で途切れました。対象を絞って再実行してください');
  const content=choice?.message?.content;
  if(typeof content!=='string')throw Error('Gemmaから本文を受信できませんでした');
  const value=JSON.parse(content.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
  return {value:validatePlan(stage,value,project,pageId),request:{model:config.model,messages},response:content};
}
