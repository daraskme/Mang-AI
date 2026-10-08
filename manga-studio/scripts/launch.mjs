import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {hostname} from 'node:os';
import { configure } from './configure.mjs';
import { packageRoot } from '../src/config.js';

const require=createRequire(import.meta.url);
const {patchPath,config}=await configure();
if(config.gpu.enabled){
  console.log('A1 4B Q8を常駐モデルとしてGPUへ読み込みます。');
  execFileSync('systemctl',['--user','start','mang-ai-agent.service','mang-ai-models.service'],{stdio:'inherit'});
}else if(config.qwen.baseURL==='http://127.0.0.1:1234/v1'&&config.qwen.model==='qwen3.8-27b-local'){
  execFileSync('systemctl',['--user','start','mang-ai-models.service'],{stdio:'inherit'});
}
const bin=join(dirname(require.resolve('@deepseek-ai/dsh/package.json')),'lib/bin.js');
const supplied=process.argv.slice(2);
if(!supplied.some(arg=>arg==='--port'||arg.startsWith('--port=')))supplied.push('--port',String(config.remoteOrigin?(config.remotePort||17860):0));
if(config.remoteOrigin){
  if(!supplied.some(arg=>arg==='--public-url'||arg.startsWith('--public-url=')))supplied.push('--public-url',config.remoteOrigin);
  supplied.push('--trusted-host',new URL(config.remoteOrigin).host);
}
const dshHome=process.env.DSH_HOME || resolve(packageRoot,'.dsh');
const initialize=existsSync(join(dshHome,'profiles/manga/package.json'))?[]:['--from-default-profile','web'];
let nativeLibraries=process.env.LD_LIBRARY_PATH||'';
if(existsSync('/etc/nixos/flake.nix')){
  const nixLibs=execFileSync('nix',['eval','--raw',`/etc/nixos#nixosConfigurations.${hostname()}.pkgs`,'--apply','p: p.lib.makeLibraryPath [ p.stdenv.cc.cc.lib ]'],{encoding:'utf8'}).trim();
  nativeLibraries=[nixLibs,nativeLibraries].filter(Boolean).join(':');
}
const child=spawn(process.execPath,[bin,'--profile','manga',...initialize,'--patch',patchPath,...supplied],{
  cwd:resolve(packageRoot,'..'),stdio:'inherit',
  env:{...process.env,LD_LIBRARY_PATH:nativeLibraries,DSH_HOME:dshHome,MANGA_QWEN_API_KEY:process.env.MANGA_QWEN_API_KEY || 'local',MANGA_AGENT_API_KEY:process.env.MANGA_AGENT_API_KEY||'local',MANGA_CODER_API_KEY:process.env.MANGA_CODER_API_KEY||'local'},
});
for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>child.kill(event));
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
