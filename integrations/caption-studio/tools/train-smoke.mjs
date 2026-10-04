import fs from 'node:fs/promises';
const base='http://127.0.0.1:3210';const html=await fetch(base).then(r=>r.text());const token=html.match(/name="studio-token" content="([^"]+)"/)[1];
async function api(p,b){const r=await fetch(base+'/api/'+p,{method:b?'POST':'GET',headers:{'X-Studio-Token':token,'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const j=await r.json();if(!r.ok)throw new Error(j.error);return j;}
const {project}=await api('state'),{settings}=await api('training/defaults');
const plan=await api('training/prepare',{config:{...settings,resolution:256,steps:1,saveEvery:1,fp8:true,blocksToSwap:0},ids:project.items.map(i=>i.id)});
await api('training/start',{id:plan.id});console.log('Smoke training run: '+plan.run);
let prior='';
for(let t=0;t<900;t++){const job=await api('training/status');if(job.phase!==prior){console.log(job.phase);prior=job.phase;}if(['completed','cancelled','error'].includes(job.state)){await fs.writeFile('docs/training-check.json',JSON.stringify(job,null,2));console.log(JSON.stringify(job));if(job.state!=='completed')process.exitCode=1;break;}await new Promise(r=>setTimeout(r,1000));}
