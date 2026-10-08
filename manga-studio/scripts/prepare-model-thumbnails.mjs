// CPU-only previews from registered training datasets; existing choices are preserved.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {loadConfig} from '../src/config.js';
import {Store} from '../src/store.js';
import {ModelLibrary} from '../src/model-library.js';

const config=loadConfig(),store=new Store(config.dataDir),models=new ModelLibrary({store,config});
const result={prepared:0,existing:0,unavailable:0,failed:0,items:[]};
try{
  const library=JSON.parse(await readFile(config.library,'utf8'));
  for(const lora of library.items.filter(i=>i.kind==='lora'&&['krea2','h3'].includes(i.family))){
    const provider=lora.family==='krea2'?'krea':'h3',id=lora.loraId;
    if(!id){result.unavailable++;continue;}
    const key=createHash('sha256').update(JSON.stringify([provider,'lora',id])).digest('hex').slice(0,32);
    if(!store.db.prepare('SELECT key FROM model_catalog WHERE key=?').get(key)){
      const data={key,provider,kind:'lora',id,name:lora.name,trigger:lora.trigger,available:false,reason:'生成環境を起動して一覧を更新してください'};
      store.db.prepare('INSERT INTO model_catalog VALUES (?,?,?)').run(key,provider,JSON.stringify(data));
    }
    if(store.db.prepare('SELECT key FROM model_thumbnails WHERE key=?').get(key)){result.existing++;continue;}
    try{
      const candidates=await models.thumbnailCandidates(key);let record;
      for(const candidate of candidates.items.slice(0,5)){
        try{record=await models.thumbnailFromFile(key,candidate.file,{kind:'training'});break;}catch{/* Try another valid source. */}
      }
      if(record){result.prepared++;result.items.push({key,provider,kind:'training',revision:record.revision});}
      else if(candidates.items.length)result.failed++;else result.unavailable++;
    }catch{result.failed++;}
  }
  const dir=join(config.dataDir,'.model-thumbnails');await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'preparation.json'),JSON.stringify({...result,createdAt:new Date().toISOString()},null,2));
  console.log(JSON.stringify({prepared:result.prepared,existing:result.existing,unavailable:result.unavailable,failed:result.failed}));
}finally{store.close();}
