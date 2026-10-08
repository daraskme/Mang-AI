import { readFile, writeFile, access, mkdir, copyFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, packageRoot } from '../src/config.js';
import { localCompactionPolicy } from '../src/context-policy.js';

/** Produce a DSH overlay without changing any existing user profile. */
export async function configure({patchPath=resolve(packageRoot,'local.patch.yml')}={}) {
  const file=process.env.MANGA_STUDIO_CONFIG || resolve(packageRoot,'studio.config.json');
  try {await access(file);} catch(error) {
    if(error.code!=='ENOENT') throw error;
    await writeFile(file,await readFile(resolve(packageRoot,'studio.config.example.json')),{flag:'wx'});
  }
  const config=loadConfig(file);
  const q=config.agent,coder=config.coder;
  const localized=JSON.parse(await readFile(resolve(packageRoot,'plugins/local-runtime/translations/ja.json'),'utf8').catch(()=> '{}'));
  for(const [ns,meta]of Object.entries(localized))if(ns.startsWith('package:'))await writeFile(resolve(packageRoot,'node_modules/@deepseek-ai',ns.slice(8),'locale/ja.json'),JSON.stringify({meta},null,2)+'\n');
  const schema=yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js',{kind:'scalar',construct:__jsExpr=>({__jsExpr})})]);
  const preset=yaml.load(await readFile(resolve(packageRoot,'node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml'),'utf8'),{schema})[0].insert[0].config;
  preset.name='Mang-AI';
  preset.description='日本語創作・画像・動画・キャプション・学習・検索・コーディング';
  preset.plugins.find(p=>p.id==='persona').config={prefix:'あなたは {{model}} を使う日本語の制作・コーディングエージェントです。',suffix:'作業ディレクトリは {{cwd}} です。'};
  preset.plugins.push({id:'tool-cordis',name:'@deepseek-ai/dsh-tool-cordis'},{id:'tool-plugin-manager',name:'@deepseek-ai/dsh-plugin-manager/tools'});
  const compaction=preset.plugins.find(p=>p.id==='compaction')?.config.find(p=>p.id==='compaction-basic');
  if(!compaction)throw Error('標準プリセットに会話要約機能がありません');
  compaction.name=resolve(packageRoot,'src/local-compaction.js');
  compaction.config={...localCompactionPolicy};
  const home=process.env.DSH_HOME||resolve(packageRoot,'.dsh'),profileDir=resolve(home,'profiles/manga');
  await mkdir(profileDir,{recursive:true});
  for(const name of ['cordis.yml','cordis.patch.yml'])try{await writeFile(resolve(profileDir,name),'[]\n',{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
  const manifestPath=resolve(profileDir,'package.json');
  let manifest;try{manifest=JSON.parse(await readFile(manifestPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;manifest={name:'dsh-profile-manga',private:true,dependencies:{},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}};}
  if(!manifest.mangAI?.localPluginsVersion){
    try{await copyFile(manifestPath,resolve(profileDir,'package.before-local-models.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
    manifest.dsh.profile.bundles=[...new Set([...manifest.dsh.profile.bundles,'@deepseek-ai/dsh-experimental-agent-team-profile','@deepseek-ai/dsh-experimental-auto-review','@deepseek-ai/dsh-experimental-inspector-profile','@deepseek-ai/dsh-experimental-voice-input-bundle'])];
    manifest.mangAI={...manifest.mangAI,localPluginsVersion:1};
    await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  }
  // JSON is valid YAML; avoid code interpolation for deployment values.
  const patch=[
    ...['llm-deepseek-account','deepseek-account','deepseek-llm-api-extensions','session-log-deepseek','plugin-package-inventory-deepseek','web-search-deepseek','ui-settings-account','account-controller','ui-settings-web-search','ui-brand-official','preset-ptc','preset-minimal','preset-cordis'].map(id=>({id,disabled:true})),
    {id:'llm-deepseek',disabled:false},
    {id:'locale',config:{preference:'ja'}},
    {id:'ui-settings-models',config:{credentialOnboarding:false}},
    {id:'web',config:{searchProvider:'mang-ai-search',fetchProvider:'http'}},
    {id:'agent-preset-registry',config:{default:'standard',selectedDefault:'standard'}},
    {id:'preset-standard',config:preset},
    {id:'speech-to-text-sensevoice',config:{dataRoot:resolve(packageRoot,'../models/speech')}},
    {id:'agent-default-model',config:{provider:'manga-agent',model:q.model}},
    {id:'llm-pi-ai',config:{providers:{'manga-agent':{
      displayName:'A1 · 常駐司令塔',api:'openai-completions',apiKeyEnv:'MANGA_AGENT_API_KEY',baseURL:q.baseURL,
      compat:{supportsDeveloperRole:false,supportsStore:false,maxTokensField:'max_tokens'},
      models:[{id:q.model,name:q.model==='agents-a1-4b-q8'?'Agents A1 4B Q8 · 常駐':q.model,contextWindow:q.contextWindow,maxTokens:Math.min(q.maxTokens,Math.floor(q.contextWindow/8)),input:q.vision?['text','image']:['text']}],
    },'manga-coder':{
      displayName:coder.displayName||`${coder.model} · コーディング`,api:'openai-completions',apiKeyEnv:'MANGA_CODER_API_KEY',baseURL:coder.baseURL,
      compat:{supportsDeveloperRole:false,supportsStore:false,maxTokensField:'max_tokens'},
      models:[{id:coder.model,name:coder.displayName||coder.model,contextWindow:coder.contextWindow,maxTokens:coder.maxTokens,input:['text']}],
    },'manga-qwen':{
      displayName:'既存セッション互換',api:'openai-completions',apiKeyEnv:'MANGA_AGENT_API_KEY',baseURL:q.baseURL,
      compat:{supportsDeveloperRole:false,supportsStore:false,maxTokensField:'max_tokens'},
      models:[{id:q.model,name:q.model,contextWindow:q.contextWindow,maxTokens:Math.min(q.maxTokens,Math.floor(q.contextWindow/8)),input:['text']}],
    }}}},
    {insert:[{id:'manga-studio',name:resolve(packageRoot,'src/plugin.js'),config:{configFile:resolve(file)}},{id:'mang-ai-local-runtime',name:'@mang-ai/local-runtime'}]},
  ];
  await writeFile(patchPath,JSON.stringify(patch,null,2)+'\n');
  return {file,patchPath,config};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const result=await configure();console.log(`設定: ${result.file}\nDSH overlay: ${result.patchPath}`);}
