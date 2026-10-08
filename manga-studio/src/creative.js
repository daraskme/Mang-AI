import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LAYOUTS, normalizeScript } from './model.js';
import { packageRoot } from './config.js';

export function parseScript(content) {
  const trimmed=content.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
  const value=JSON.parse(trimmed);
  return normalizeScript(value);
}
/** Gemma writes; the resident agent calls this capability. */
export async function writeScript(project, config, instruction, pageCount, signal) {
  const dialogueRules=await readFile(resolve(packageRoot,'../guidelines/02-narrative-craft.md'),'utf8');
  const section=dialogueRules.split('### 4-10.')[1]?.split('\n## 5.')[0];
  if(!section) throw new Error('guidelines/02-narrative-craft.md §4-10 が見つかりません');
  const system=`あなたは日本語漫画の脚本家です。指定設定と話者・聞き手・行為者の対応を保ち、人物の声に合う自然な日本語で書いてください。画像には文字を描かせません。artPrompt は構図・外見・衣装・表情・瞬間の動作を具体的な英語で書き、台詞は dialogue に分離します。台詞の本数と話者に合わせ、空の吹き出しを収める縦長の領域を顔や手と重ならない位置に確保してください。空吹き出しの描画方式と配置は作画ツールが最終指定します。1コマ1時点。右から左の日本漫画。フルカラー。1ページ2〜4コマ。隣接ページの layout を変えてください。JSON だけを返してください。\n台詞規約：${section}\nlayout と必要コマ数：${JSON.stringify(Object.fromEntries(Object.entries(LAYOUTS).map(([k,v])=>[k,v.length])))}\n出力形式：{"pages":[{"layout":"縦2（上大）","purpose":"ページの仕事","panels":[{"action":"画面内で見える事実","artPrompt":"English visual description without lettering; reserve room for empty balloons","dialogue":[{"speaker":"話者","text":"日本語の台詞"}]}]}]}。dialogue は無言のコマでは [] にします。`;
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

export async function writeMediaPrompt(config,{provider,instruction,context,selection},signal){
  if(!['krea','h3','longvideo'].includes(provider))throw Error('生成環境が不正です');
  if(typeof instruction!=='string'||!instruction.trim()||instruction.length>20000)throw Error('制作指示は1〜20000文字です');
  const format=provider==='krea'?'具体的な英語の自然言語で、人物・外見と衣装・一瞬の動作・構図・背景・光・画風を記述する。台詞や吹き出しの文字は画像に含めず、別ツールで入力する。4000文字以内。':provider==='longvideo'?'最初の段落に共通の人物・場所・外見を英語で書く。空行で区切った次の段落から1段落1ショットにする。各ショットに一貫した動作・カメラ・環境音を書き、音声の台詞は二重引用符内に原語のまま書く。共通段落だけではなく必ずショット段落も書く。':'1ショットの動画指示を英語で書く。開始状態、人物・背景、順に起きる動き、カメラ、音を具体的にし、音声の台詞は二重引用符内に原語で書く。';
  const messages=[{role:'system',content:`あなたはGemma 4、漫画・動画の自然言語プロンプトを担当します。司令塔の依頼、確定設定、利用者指定のモデル・LoRAを保持します。${format} 指定にない人物・行為・画風を追加しない。登録済みのLoRAトリガーがあれば使用し、不明なら推測しない。JSONだけを返す: {"prompt":"生成用の文章","notes":["未決事項や検査する点"]}`},{role:'user',content:JSON.stringify({instruction,context,selection})}];
  const key=process.env[config.apiKeyEnv],response=await fetch(`${config.baseURL}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},signal:AbortSignal.any([signal,AbortSignal.timeout(config.timeoutMs)]),body:JSON.stringify({model:config.model,messages,stream:false,temperature:config.temperature,max_tokens:config.maxTokens})});
  if(!response.ok)throw Error(`Gemma API: HTTP ${response.status}`);
  const choice=(await response.json()).choices?.[0];if(choice?.finish_reason==='length')throw Error('Gemmaのプロンプト出力が途中で切れました');
  const raw=choice?.message?.content;if(typeof raw!=='string')throw Error('Gemmaから本文を受信できませんでした');
  const value=JSON.parse(raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
  if(typeof value.prompt!=='string'||!value.prompt.trim()||value.prompt.length>(provider==='krea'?4000:20000))throw Error('Gemmaのプロンプトが空、または長すぎます');
  return {...value,request:{model:config.model,messages},response:raw};
}
