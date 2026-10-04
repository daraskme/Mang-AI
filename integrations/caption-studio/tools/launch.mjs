import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {createApp} from '../server.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const noBrowser=process.argv.includes('--no-browser');
const logFile=path.join(root,'.caption-studio','startup.log');
async function log(message){
  console.error(message);
  await fs.mkdir(path.dirname(logFile),{recursive:true}).catch(()=>{});
  await fs.appendFile(logFile,`[${new Date().toISOString()}] ${message}\n`).catch(()=>{});
}
async function openBrowser(url){
  const env={...process.env};
  // The browser uses its OS libraries, separately from the bundled Node runtime.
  delete env.LD_LIBRARY_PATH;
  delete env.PYTHONHOME;
  delete env.PYTHONPATH;
  const result=await new Promise(resolve=>{
    const child=spawn('xdg-open',[url],{env,stdio:['ignore','pipe','pipe']});
    let detail='';
    child.stdout.on('data',chunk=>{detail=(detail+chunk).slice(-4000);});
    child.stderr.on('data',chunk=>{detail=(detail+chunk).slice(-4000);});
    child.on('error',e=>resolve({code:1,detail:e.message}));
    child.on('close',code=>resolve({code,detail}));
  });
  if(result.code!==0){
    await log(`ブラウザを自動で開けませんでした。ブラウザで ${url} を開いてください。\n${result.detail}`);
  }
}
async function main(){
  const port=Number(process.env.PORT||3210);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORTは1024〜65535の整数で指定してください。');
  const url=`http://127.0.0.1:${port}`;
  let app;
  try{
    app=await createApp({port});
    console.log('Krea Caption Studio: '+app.url);
  }catch(e){
    if(e.code!=='EADDRINUSE')throw e;
    const response=await fetch(url,{signal:AbortSignal.timeout(3000)});
    const html=await response.text();
    if(!response.ok||!html.includes('<title>Krea Caption Studio</title>')||!html.includes('name="studio-token"')){
      throw new Error(`ポート${port}を別のアプリが使用しています。PORT=3211 ./start.sh など、別のポートで起動してください。`);
    }
    console.log('起動済みのCaption Studioを開きます: '+url);
  }
  if(app){
    let stopping=false;
    const stop=()=>{
      if(stopping)return;stopping=true;
      app.jobs.stop();
      try{app.training.stop();}catch{}
      if(app.engine.child)app.engine.stop();
      app.server.close();
      setTimeout(()=>process.exit(),9000).unref();
    };
    for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.on(signal,stop);
  }
  if(!noBrowser)await openBrowser(url);
}
try{await main();}catch(e){
  await log('Caption Studioを起動できませんでした。\n'+(e.stack||e.message));
  console.error('起動ログ: '+logFile);
  if(!noBrowser&&process.stdin.isTTY){
    const reader=createInterface({input:process.stdin,output:process.stdout});
    await reader.question('Enterキーで閉じます。');reader.close();
  }
  process.exitCode=1;
}
