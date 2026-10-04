// Adapt the project-local official Node executable to NixOS's ELF loader.
import { readdir, access, realpath, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { packageRoot } from '../src/config.js';

await access('/etc/NIXOS');
const entries=await readdir('/nix/store');
async function locate(pattern,suffix){
  for(const name of entries.filter(n=>pattern.test(n)).sort().reverse()){
    const path=join('/nix/store',name,suffix);try{await access(path);if(suffix.endsWith('libstdc++.so.6')&&(await readFile(path))[4]!==2)continue;return path;}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  throw new Error(`${pattern} ${suffix} がありません。Nix で patchelf / gcc / glibc を用意してください`);
}
const patcher=await locate(/-patchelf-[\d.]+$/,'bin/patchelf');
const loader=await locate(/-glibc-[\d.-]+$/,'lib/ld-linux-x86-64.so.2');
const stdcxx=await locate(/^[a-z0-9]+-gcc-[\d.]+-lib$/,'lib/libstdc++.so.6');
const binary=await realpath(join(packageRoot,'node_modules/node/bin/node'));
const result=spawnSync(patcher,['--set-interpreter',loader,'--set-rpath',join(stdcxx,'..')+':'+join(loader,'..'),binary],{stdio:'inherit'});
if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);
console.log('プロジェクト内の Node を NixOS 用に設定しました。');
