import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const base=process.env.A1_TEST_URL||'http://127.0.0.1:1240/v1';
const call=async body=>{const r=await fetch(base+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'agents-a1-4b-q8',max_tokens:1200,temperature:0.2,chat_template_kwargs:{enable_thinking:false},...body}),signal:AbortSignal.timeout(180000)});assert(r.ok,`HTTP ${r.status}`);return r.json();};
const tool=await call({messages:[{role:'system',content:'日本語の制作エージェントです。GPUの状態はツールで確認してください。'},{role:'user',content:'GPUの空き状況を確認して。'}],tools:[{type:'function',function:{name:'gpu_status',description:'GPUとRAMの現在の空きを調べる',parameters:{type:'object',properties:{},additionalProperties:false}}}],tool_choice:'auto'});
assert.equal(tool.choices[0].message.tool_calls?.[0]?.function.name,'gpu_status');
const result={tool};
if(process.argv[2]){
  const bytes=await readFile(resolve(process.argv[2]));
  result.vision=await call({messages:[{role:'user',content:[{type:'text',text:'この画像を見て、漫画のコマ数と、見えている背景・人物の動作を短く日本語で説明してください。推測は区別してください。'},{type:'image_url',image_url:{url:'data:image/png;base64,'+bytes.toString('base64')}}]}]});
  assert(result.vision.choices[0].message.content?.trim());
}
await mkdir('.test-output',{recursive:true});await writeFile('.test-output/resident-a1-smoke.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({tool:tool.choices[0].message.tool_calls[0].function.name,vision:result.vision?.choices[0].message.content,output:'.test-output/resident-a1-smoke.json'}));
