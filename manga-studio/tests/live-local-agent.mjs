import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadConfig,packageRoot} from '../src/config.js';
const root=resolve(packageRoot,'.test-output/real-agent');await mkdir(root,{recursive:true});
const config=loadConfig();config.dataDir=resolve(root,'data');config.editorPort=0;
await writeFile(resolve(root,'config.json'),JSON.stringify(config));
const patch=[
  {id:'llm-deepseek',disabled:true},{id:'web-search-deepseek',disabled:true},
  {id:'web',config:{searchProvider:'mang-ai-search',fetchProvider:'http'}},
  {id:'agent-default-model',config:{provider:'local-qwen',model:config.qwen.model}},
  {id:'llm-pi-ai',config:{providers:{'local-qwen':{api:'openai-completions',apiKeyEnv:'MANGA_TEST_KEY',baseURL:config.qwen.baseURL,compat:{supportsDeveloperRole:false,supportsStore:false,maxTokensField:'max_tokens'},models:[{id:config.qwen.model,contextWindow:32768,maxTokens:4096,input:['text']}]}}}},
  {insert:[{id:'local-runtime',name:resolve(packageRoot,'plugins/local-runtime/index.js')},{id:'manga-studio',name:resolve(packageRoot,'src/plugin.js'),config:{configFile:resolve(root,'config.json')}}]},
];
await writeFile(resolve(root,'patch.json'),JSON.stringify(patch));
const task='これはローカルQwenの結合試験です。web_searchで「Krea 2 official inference github」を1回検索し、公式コードのURLを日本語で1文にまとめてください。次に media_open_generator を呼び、GUIのURLを示してください。ファイル変更や画像生成は不要です。';
const child=spawn(process.execPath,[resolve(packageRoot,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','headless','--patch',resolve(root,'patch.json'),'--json',task],{cwd:root,env:{...process.env,DSH_HOME:resolve(root,'dsh'),MANGA_TEST_KEY:'local'},stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
const timeout=setTimeout(()=>child.kill('SIGTERM'),240000);
const code=await new Promise(r=>child.on('exit',r));clearTimeout(timeout);
await writeFile(resolve(root,'events.jsonl'),stdout);await writeFile(resolve(root,'stderr.log'),stderr);
console.log('Exit',code,'events bytes',stdout.length,'diagnostics',stderr.slice(-1800));
if(code!==0||!stdout.includes('web_search')||!stdout.includes('media_open_generator'))throw Error('Actual local agent tool test failed; inspect .test-output/real-agent');
console.log('PASS actual Qwen → web search → generation GUI');
