import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LAYOUTS, normalizeScript } from './model.js';
import { packageRoot } from './config.js';

export function parseScript(content) {
  const trimmed=content.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
  const value=JSON.parse(trimmed);
  return normalizeScript(value);
}
/** Gemma writes; Qwen remains the DSH agent and calls this capability. */
export async function writeScript(project, config, instruction, pageCount, signal) {
  const dialogueRules=await readFile(resolve(packageRoot,'../guidelines/02-narrative-craft.md'),'utf8');
  const section=dialogueRules.split('### 4-10.')[1]?.split('\n## 5.')[0];
  if(!section) throw new Error('guidelines/02-narrative-craft.md §4-10 が見つかりません');
  const system=`あなたは日本語漫画の脚本家です。指定設定と話者・聞き手・行為者の対応を保ち、人物の声に合う自然な日本語で書いてください。画像には文字を描かせません。artPrompt は構図・外見・衣装・表情・瞬間の動作を具体的な英語で書き、台詞は dialogue に分離します。後から台詞を置く余白は plain background / negative space と位置で指定し、speech bubble space のような吹き出しの形を連想させる指示は書かないでください。1コマ1時点。右から左の日本漫画。フルカラー。1ページ2〜4コマ。隣接ページの layout を変えてください。JSON だけを返してください。\n台詞規約：${section}\nlayout と必要コマ数：${JSON.stringify(Object.fromEntries(Object.entries(LAYOUTS).map(([k,v])=>[k,v.length])))}\n出力形式：{"pages":[{"layout":"縦2（上大）","purpose":"ページの仕事","panels":[{"action":"画面内で見える事実","artPrompt":"English visual description without any text or speech bubbles","dialogue":[{"speaker":"話者","text":"日本語の台詞"}]}]}]}。dialogue は無言のコマでは [] にします。`;
  const messages=[{role:'system',content:system},{role:'user',content:JSON.stringify({title:project.title,brief:project.brief,characters:project.characters,style:project.style,existingPages:project.pages,instruction,pageCount})}];
  const headers={'Content-Type':'application/json'};
  const key=process.env[config.apiKeyEnv];
  if(key) headers.Authorization=`Bearer ${key}`;
  const response=await fetch(`${config.baseURL}/chat/completions`,{
    method:'POST',headers,signal:AbortSignal.any([signal,AbortSignal.timeout(config.timeoutMs)]),
    body:JSON.stringify({model:config.model,messages,stream:false,temperature:config.temperature,max_tokens:config.maxTokens}),
  });
  if(!response.ok) throw new Error(`Gemma API: HTTP ${response.status}。接続先、モデルID、サーバーログを確認してください`);
  const data=await response.json();
  const choice=data.choices?.[0];
  if(choice?.finish_reason==='length') throw new Error('Gemma の出力が上限で途切れました。ページ数を減らすか maxTokens を増やしてください');
  if(typeof choice?.message?.content!=='string') throw new Error('Gemma API から本文を受信できませんでした');
  let pages;
  try {pages=parseScript(choice.message.content);} catch(error) {throw new Error(`Gemma 脚本を保存できませんでした：${error.message}`);}
  if(pages.length!==pageCount) throw new Error(`Gemma が ${pages.length} ページを返しました。指定は ${pageCount} ページです`);
  return {pages,request:{model:config.model,messages},response:choice.message.content};
}
