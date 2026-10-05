import { spawn } from 'node:child_process';
export const nativeSubprocess={spawn(spec){
  let stderr='',stdout='';
  const child=spawn(spec.argv[0],spec.argv.slice(1),{cwd:spec.cwd,env:{...process.env,...spec.env},stdio:['pipe','pipe','pipe'],detached:true});
  child.stderr.on('data',b=>stderr=(stderr+b).slice(-16000));child.stdin.on('error',()=>{});child.stdin.end(spec.stdio?.stdin?.data);
  child.stdout.on('data',b=>stdout=(stdout+b).slice(-16000));
  const stop=()=>{try{process.kill(-child.pid,'SIGTERM');}catch{};};
  spec.signal?.addEventListener('abort',stop,{once:true});if(spec.signal?.aborted)stop();
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',exitCode=>{spec.signal?.removeEventListener('abort',stop);resolve({exitCode});});});
  return {stdout:child.stdout,done,waitForExit:()=>done,collected:{stderr:{readFrom:()=>({text:stderr})},stdout:{readFrom:()=>({text:stdout})}}};
}};
