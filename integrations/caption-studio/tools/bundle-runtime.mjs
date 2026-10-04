import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=process.cwd(),lib=path.join(root,'runtime/lib');
const llama='/nix/store/1a1gc0c1yndbcw1hii58a6z5fnk2fhdh-llama-cpp-0.4.1';
const python='/nix/store/bszqvgwpxb1gq1xpx8s6qv92wgb9dqli-python3-3.12.14';
const venv='/home/hiroshi/プロジェクト/krea2-darask/.venv';
const seen=new Set(), manifest=[];
async function copyElf(source,destination) {
  if(seen.has(source))return;seen.add(source);
  await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(await fs.realpath(source),destination);await fs.chmod(destination,0o755);
  manifest.push({source,destination:path.relative(root,destination)});
  let linked='';try{linked=execFileSync('/run/current-system/sw/bin/ldd',[source],{encoding:'utf8'});}catch(e){throw e;}
  for(const line of linked.split('\n')) {
    const dep=line.match(/=> (\/\S+)/)?.[1] || line.match(/^\s*(\/\S+)\s+\(/)?.[1];
    if(dep && !dep.startsWith('/run/opengl-driver/') && !/nvidia-x11/.test(dep))await copyElf(dep,path.join(lib,path.basename(dep)));
  }
}
await copyElf(await fs.realpath(process.execPath),path.join(root,'runtime/bin/node.bin'));
await copyElf(llama+'/bin/llama-server',path.join(root,'runtime/bin/llama-server.bin'));
for(const dir of ['lib','bin'])for(const name of await fs.readdir(path.join(llama,dir)))if(/\.so(?:\.|$)/.test(name))await copyElf(path.join(llama,dir,name),path.join(lib,name));
await copyElf(python+'/bin/python3.12',path.join(root,'runtime/python/bin/python3.12'));
console.log('ELF libraries copied; copying Python standard library and training packages…');
await fs.cp(python+'/lib/python3.12',path.join(root,'runtime/python/lib/python3.12'),{recursive:true,dereference:true,filter:p=>!p.includes('__pycache__')});
execFileSync('/run/current-system/sw/bin/chmod',['-R','u+w',path.join(root,'runtime/python')]);
await fs.cp(venv+'/lib/python3.12/site-packages',path.join(root,'runtime/python/lib/python3.12/site-packages'),{recursive:true,dereference:true});
await fs.cp('/run/media/hiroshi/ボリューム/krea2/musubi-tuner',path.join(root,'vendor/musubi-tuner'),{recursive:true,dereference:true,filter:p=>!['.git','__pycache__'].includes(path.basename(p))});
await fs.cp('/home/hiroshi/.cache/huggingface/hub/models--Qwen--Qwen3-VL-4B-Instruct',path.join(root,'runtime/huggingface/hub/models--Qwen--Qwen3-VL-4B-Instruct'),{recursive:true,dereference:true});
const site=path.join(root,'runtime/python/lib/python3.12/site-packages');
for(const name of await fs.readdir(site))if(name.endsWith('.pth')) {
  const text=await fs.readFile(path.join(site,name),'utf8');
  if(text.includes('/home/hiroshi/') || text.includes('/run/media/hiroshi/'))await fs.writeFile(path.join(site,name),'# External editable project path removed in local bundle.\n');
}
await fs.writeFile(path.join(root,'runtime/bundle-manifest.json'),JSON.stringify({created:new Date().toISOString(),platform:'linux-x86_64',external:['NVIDIA kernel/display driver','Web browser'],files:manifest},null,2));
console.log('Runtime bundle complete.');
