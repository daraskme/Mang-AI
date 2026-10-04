import fs from 'node:fs/promises';
const base='http://127.0.0.1:3210';
const html=await fetch(base).then(r=>r.text());const token=html.match(/name="studio-token" content="([^"]+)"/)[1];
async function api(p,b){const r=await fetch(base+'/api/'+p,{method:b?'POST':'GET',headers:{'X-Studio-Token':token,'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const j=await r.json();if(!r.ok)throw new Error(j.error);return j;}
if(!(await api('state')).project)await api('open',{folder:process.cwd()+'/examples/demo',recursive:true});
let e=await api('engine/status');if(e.health==='offline'){await api('engine/start',{});console.log('Loading bundled Gemma…');}
for(let i=0;i<240;i++){e=await api('engine/status');if(e.health==='ready')break;if(!e.managed)throw new Error(e.logs.join('\n'));await new Promise(r=>setTimeout(r,1000));}
if(e.health!=='ready')throw new Error('Model load timeout');console.log('Gemma ready: '+e.model);
const s=await api('state');await api('job/start',{ids:[s.project.items[0].id],overwrite:true});
for(let i=0;i<300;i++){const state=await api('state');if(['completed','error','cancelled'].includes(state.job?.state)){await fs.writeFile('docs/inference-check.json',JSON.stringify({model:e.model,job:state.job,item:state.project.items[0]},null,2));if(state.job.failed||state.job.state!=='completed')throw new Error(JSON.stringify(state.job));console.log(state.project.items[0].caption);break;}await new Promise(r=>setTimeout(r,1000));}
