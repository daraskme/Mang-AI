import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';

const defaultModel='DasiwaMinimaxH3_dasiwaHybridTurboV3_3263048.safetensors';
export function planLongVideo(args) {
  if(typeof args.prompt!=='string'||!args.prompt.trim()||args.prompt.length>20000)throw Error('動画の指示を1〜20000文字で入力してください');
  const paragraphs=args.prompt.trim().split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean);
  if(paragraphs.length<2)throw Error('最初の段落に共通の場面設定、空行で区切った次の段落から各ショットを書いてください');
  const seconds=args.shot_seconds??8;
  if(!Number.isFinite(seconds)||seconds<1||seconds>15)throw Error('1ショットは1〜15秒です');
  if(paragraphs.length>25||(paragraphs.length-1)*seconds>120)throw Error('合計120秒以内、24ショット以内に分けてください');
  const steps=args.steps??8;
  if(!Number.isInteger(steps)||steps<4||steps>50)throw Error('ステップ数は4〜50です');
  const megapixels=args.megapixels??0.4;
  if(!Number.isFinite(megapixels)||megapixels<0.2||megapixels>2)throw Error('解像度は0.2〜2 MPです');
  return {scene:paragraphs[0],shots:paragraphs.slice(1).map((prompt,i)=>({number:i+1,prompt,seconds})),estimatedSeconds:(paragraphs.length-1)*seconds,steps,megapixels,note:'尺はフレーム整列・ショット接続で変わります。台詞は二重引用符で指定し、環境音は各ショットに明記してください。'};
}

export async function submitLongVideo(studios,session,args,signal) {
  const plan=planLongVideo(args),model=args.model||studios.config.longvideo?.model||defaultModel;
  const info=await studios.request('longvideo','/object_info/H3LongVideos',{signal});
  if(!info.H3LongVideos)throw Error('H3-LongVideos が読み込まれていません');
  const names=await studios.request('longvideo','/object_info/UNETLoader',{signal});
  if(!names.UNETLoader.input.required.unet_name[0].includes(model))throw Error('未導入のH3モデルです。media_status でモデル一覧を確認してください');
  const run=randomUUID(),inputs={model:['1',0],clip:['2',0],vae:['3',0],audio_vae:['4',0],prompt:args.prompt,
    resolution:args.resolution||'16:9',megapixels:plan.megapixels,shot_seconds:args.shot_seconds??8,steps:plan.steps,
    sampler_name:args.sampler_name||'res_multistep',scheduler:'simple',seed:args.seed??0,
    shot_length:'fixed',shift_video:args.shift_video??8,shift_audio:args.shift_audio??4,
    anchor:args.anchor||'',character_memory:args.character_memory||'',hold_levels:0.8,
    latent_upscale:args.latent_upscale||'off',latent_upscale_scale:args.latent_upscale_scale??1.5,
    upscale:args.upscale||'off',upscale_target_short_edge:args.upscale_target_short_edge??0};
  const graph={
    '1':{class_type:'UNETLoader',inputs:{unet_name:model,weight_dtype:'default'}},
    '2':{class_type:'CLIPLoader',inputs:{clip_name:'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',type:'minimax',device:'default'}},
    '3':{class_type:'VAELoader',inputs:{vae_name:'minimax_h3_video_vae_fp16.safetensors'}},
    '4':{class_type:'VAELoader',inputs:{vae_name:'minimax_h3_audio_vae_fp32.safetensors'}},
    '5':{class_type:'H3LongVideos',inputs},
    '6':{class_type:'CreateVideo',inputs:{images:['5',0],audio:['5',1],fps:24}},
    '7':{class_type:'SaveVideo',inputs:{video:['6',0],filename_prefix:`mang-ai/${run}/video`,format:'mp4','format.codec':'h264'}},
    '8':{class_type:'PreviewAny',inputs:{source:['5',2]}},
  };
  const adapters=(args.loras||[]).filter(x=>x.enabled!==false);
  if(adapters.length>16)throw Error('LoRAは16個以内です');
  if(adapters.length){
    const catalog=await studios.request('longvideo','/object_info/LoraLoaderModelOnly',{signal});
    const names=catalog.LoraLoaderModelOnly.input.required.lora_name[0];
    for(const [index,lora] of adapters.entries()){
      if(!names.includes(lora.path)||!Number.isFinite(lora.weight??1)||Math.abs(lora.weight??1)>4)throw Error('LoRA名または強度が不正です');
      if(/turbo|lightx2v|fasth3|taomate|pdd/i.test(lora.path))throw Error('蒸留済みチェックポイントに加速LoRAは重ねられません');
      const node=String(20+index);graph[node]={class_type:'LoraLoaderModelOnly',inputs:{model:inputs.model,lora_name:lora.path,strength_model:lora.weight??1}};inputs.model=[node,0];
    }
  }
  if(args.firstFramePath) {
    const file=args.firstFramePath,mime={'.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'}[extname(file).toLowerCase()];
    if(!mime||(await stat(file)).size>32*1024*1024)throw Error('先頭画像は32MB以下のPNG/JPEG/WebPです');
    const form=new FormData();form.append('image',new Blob([await readFile(file)],{type:mime}),`${run}-${basename(file)}`);form.append('overwrite','false');
    const uploaded=await studios.request('longvideo','/upload/image',{body:form,signal,timeoutMs:60000});
    graph['9']={class_type:'LoadImage',inputs:{image:[uploaded.subfolder,uploaded.name].filter(Boolean).join('/')}};
    inputs.first_frame=['9',0];
  }
  const result=await studios.request('longvideo','/prompt',{body:{prompt:graph,prompt_id:run,client_id:`mang-ai-${run}`},signal});
  if(!result.prompt_id||Object.keys(result.node_errors||{}).length)throw Error(`長尺動画の構成が無効です: ${JSON.stringify(result.node_errors)}`);
  const id=studios.save(session,'media',{provider:'longvideo',remoteId:result.prompt_id,request:args,plan});
  return {id,provider:'longvideo',remoteId:result.prompt_id,plan};
}

export async function longVideoJob(studios,ref,action,signal) {
  if(action==='cancel') {
    await studios.request('longvideo','/queue',{body:{delete:[ref.remoteId]},raw:true,signal});
    // The pinned ComfyUI supports targeted interruption; never interrupt other sessions.
    await studios.request('longvideo','/interrupt',{body:{prompt_id:ref.remoteId},raw:true,signal});
    return {status:'cancelled',cancelRequested:true};
  }
  const history=(await studios.request('longvideo',`/history/${encodeURIComponent(ref.remoteId)}`,{signal}))[ref.remoteId];
  if(history) {
    const error=history.status?.messages?.find(([kind])=>['execution_error','execution_interrupted'].includes(kind));
    if(error)return {status:error[0]==='execution_interrupted'?'cancelled':'failed',error:error[1]?.exception_message||error[0]};
    const files=Object.values(history.outputs||{}).flatMap(o=>[...(o.images||[]),...(o.gifs||[]),...(o.videos||[])]);
    const video=files.find(f=>f.type==='output'&&f.filename?.endsWith('.mp4')&&f.subfolder===`mang-ai/${ref.remoteId}`);
    if(history.status?.status_str==='success'&&!video)return {status:'failed',error:'処理は終了しましたが動画ファイルがありません'};
    const q=video?new URLSearchParams({filename:video.filename,subfolder:video.subfolder,type:'output'}):null;
    const info=history.outputs?.['8']?.text||[];
    const warnings=/latent upscale failed|node pack is not installed|returned an unexpected shape/.test(info.join(' '))?['潜在アップスケールが適用されませんでした。動画は元の解像度です。']:[];
    return {status:video?'completed':'running',...video?{output_url:'/view?'+q}:{},info,warnings,plan:ref.plan};
  }
  const queue=await studios.request('longvideo','/queue',{signal});
  if(queue.queue_running.some(x=>x[1]===ref.remoteId))return {status:'running',message:'ショットの生成・接続処理中',plan:ref.plan};
  if(queue.queue_pending.some(x=>x[1]===ref.remoteId))return {status:'queued',plan:ref.plan};
  return {status:'unknown',message:'実行記録がありません。サーバー再起動・履歴削除・取消の可能性があります'};
}
