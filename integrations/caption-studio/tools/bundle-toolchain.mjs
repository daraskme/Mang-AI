import fs from 'node:fs/promises';import path from 'node:path';import {execFileSync}from'node:child_process';
const root=process.cwd(),r=path.join(root,'runtime'),lib=path.join(r,'lib'),gcc='/nix/store/8sjgd7q3mdks1rb7rbcv0sallhvrhai5-gcc-15.3.0',binutils='/nix/store/31gnwsgag5qa14hfblqi5hyn71pyx7py-binutils-2.46';
await fs.cp(gcc,path.join(r,'toolchain/gcc'),{recursive:true,dereference:true});
await fs.cp('/nix/store/lbjwxax9n0457lgd83rqwpd1l9lgfl7r-glibc-2.42-84-dev/include',path.join(r,'toolchain/include'),{recursive:true,dereference:true});
await fs.cp('/nix/store/bszqvgwpxb1gq1xpx8s6qv92wgb9dqli-python3-3.12.14/include',path.join(r,'python/include'),{recursive:true,dereference:true});
await fs.mkdir(path.join(r,'toolchain/bin'),{recursive:true});
for(const f of ['as','ld','ld.bfd'])await fs.copyFile(await fs.realpath(path.join(binutils,'bin',f)),path.join(r,'toolchain/bin',f));
execFileSync('/run/current-system/sw/bin/chmod',['-R','u+w',path.join(r,'toolchain')]);
const seen=new Set();async function deps(file){if(seen.has(file))return;seen.add(file);let text;try{text=execFileSync('/run/current-system/sw/bin/ldd',[file],{encoding:'utf8',stdio:['ignore','pipe','ignore']});}catch{return;}for(const m of text.matchAll(/=> (\/\S+)|^\s*(\/\S+)\s+\(/gm)){const p=m[1]||m[2];if(p.startsWith('/run/opengl-driver/')||p.includes('nvidia-x11'))continue;const target=path.join(lib,path.basename(p));if(!await fs.stat(target).catch(()=>null))await fs.copyFile(await fs.realpath(p),target);await deps(p);}}
async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(e.isFile()){const h=await fs.open(p,'r'),b=Buffer.alloc(4);await h.read(b,0,4,0);await h.close();if(b.equals(Buffer.from([127,69,76,70]))){await deps(p);const loader=path.join(lib,'ld-linux-x86-64.so.2');try{execFileSync(loader,['--library-path',lib,path.join(r,'bin/patchelf.bin'),'--set-interpreter',loader,p],{stdio:'ignore'});}catch{}}}}}
await walk(path.join(r,'toolchain'));await walk(path.join(r,'python/lib/python3.12/lib-dynload'));
for(const f of ['ptxas','ptxas-blackwell']){const p=path.join(r,'python/lib/python3.12/site-packages/triton/backends/nvidia/bin',f);await deps(p);execFileSync(path.join(lib,'ld-linux-x86-64.so.2'),['--library-path',lib,path.join(r,'bin/patchelf.bin'),'--set-interpreter',path.join(lib,'ld-linux-x86-64.so.2'),p]);}
console.log('C toolchain, Python headers and Triton executables bundled.');
