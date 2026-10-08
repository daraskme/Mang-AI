import {realpath,mkdir,stat,unlink} from 'node:fs/promises';
import {join,extname,dirname,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {packageRoot} from './config.js';
const execute=promisify(execFile);
export async function postingCopy(studios,source,signal){
  const file=await realpath(source),roots=await studios.models.referenceRoots();
  if(!roots.some(root=>file.startsWith(root+sep)))throw Error('データセット・生成物から選んでください');
  const ext=extname(file).toLowerCase(),video=['.mp4','.mov','.mkv','.webm'].includes(ext);
  if(!video&&!['.png','.jpg','.jpeg','.webp','.avif','.bmp'].includes(ext))throw Error('投稿用コピーは静止画像と動画に対応しています');
  // Preserve the video container for codec compatibility; images export to PNG.
  const suffix=video?ext:'.png',dir=join(studios.store.root,'.posting-copies');await mkdir(dir,{recursive:true});
  const output=join(dir,randomUUID()+suffix),root=resolve(dirname(studios.config.library),'..');
  try{
    await execute(studios.config.thumbnailPython||join(root,'caption-studio/runtime/python-run'),[join(packageRoot,'python/media_metadata.py'),file,output],{signal,timeout:120000,maxBuffer:32768});
    return {path:output,type:video?({'.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.mkv':'video/x-matroska'}[ext]):'image/png',bytes:(await stat(output)).size,filename:'mangai-post'+suffix,metadataRemoved:true};
  }catch(error){await unlink(output).catch(()=>{});throw Error('投稿用コピーを作成できませんでした。対応形式・Python・ffmpegを確認してください',{cause:error});}
}
