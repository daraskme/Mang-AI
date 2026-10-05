import test from 'node:test';
import assert from 'node:assert/strict';
import LocalCompactionEngine from '../src/local-compaction.js';
import {localCompactionPolicy} from '../src/context-policy.js';

test('local summaries omit the tool catalog, preserve conversation and routing, and reject truncation',async()=>{
  let sent,finish='stop';
  const config={...localCompactionPolicy,modelPolicies:[],summarizationProvider:'',summarizationModel:''};
  const context={config,ctx:{llm:{async *stream(options){sent=options;yield {type:'block-end',index:0,block:{type:'text',text:'Saved page p1; Kroma rendering pending.'}};yield {type:'finish',reason:{kind:finish}};}}}};
  const history={};const agent={options:{},session:{id:'session-test',requestHeader:()=>({config:{provider:'local',model:'qwen'}}),toolHistory:()=>history}};
  const input={tools:[{name:'manga_render'}],messages:[{role:'system',content:[{type:'text',text:'LARGE_AGENT_INSTRUCTIONS'}]},{role:'user',content:[{type:'text',text:'漫画の台詞は縦書き。'}]},{role:'assistant',content:[{type:'tool-call',id:'render-1',name:'manga_render',arguments:{pageId:'p1'}}]},{role:'tool',content:[{type:'text',text:'{"status":"queued"}'}]}]};
  const original=structuredClone(input),signal=new AbortController().signal;
  const result=await LocalCompactionEngine.prototype.summarize.call(context,input,agent,signal);
  assert.equal(sent.tools,undefined);assert.equal(sent.provider,'local');assert.equal(sent.model,'qwen');
  assert.equal(sent.signal,signal);assert.equal(sent.toolHistory,history);
  assert(!JSON.stringify(sent.messages).includes('LARGE_AGENT_INSTRUCTIONS'));
  assert.deepEqual(sent.messages.slice(1,-1),input.messages.slice(1));assert.deepEqual(input,original);
  assert.equal(result.summary[0].text,'Saved page p1; Kroma rendering pending.');
  finish='max-tokens';await assert.rejects(LocalCompactionEngine.prototype.summarize.call(context,input,agent,signal),/incomplete checkpoint/);
});
