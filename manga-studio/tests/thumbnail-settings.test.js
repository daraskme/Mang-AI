import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {MangaService} from '../src/service.js';
import {MediaGallery} from '../src/gallery.js';
import {config,tempRoot,png} from './fixtures.js';

test('optimized datasets supply thumbnail candidates; outside links are excluded and clear persists',async()=>{
  const root=await tempRoot('thumb-settings'),c=config(join(root,'sessions')),dir=join(root,'datasets-optimized','sample');
  await mkdir(dir,{recursive:true});await mkdir(join(root,'models'));c.library=join(root,'models/training-library.json');
  await writeFile(c.library,JSON.stringify({items:[{kind:'lora',family:'krea2',name:'sample',loraId:'sample'},
    {kind:'dataset',family:'krea2',name:'sample',path:dir,images:1,videos:0}]}));
  await writeFile(join(dir,'one.png'),png);await writeFile(join(root,'secret.png'),png);await symlink(join(root,'secret.png'),join(dir,'outside.png'));
  const service=new MangaService(c,{}),gallery=new MediaGallery(service);service.studios.request=async(_p,path)=>({items:path==='/api/models'?[]:[{id:'sample'}]});
  try{
    const key=(await service.studios.models.catalog('krea')).items[0].key;
    const candidates=await service.studios.models.thumbnailCandidates(key);assert.equal(candidates.items.length,1);assert.equal(candidates.items[0].kind,'training');
    await assert.rejects(service.studios.models.thumbnailFromFile(key,join(root,'secret.png')),/フォルダ/);
    await service.studios.models.thumbnail(key,'data:image/png;base64,'+png.toString('base64'),{kind:'training'});
    assert.equal((await service.studios.models.catalog('krea')).items[0].thumbnail.kind,'training');
    service.studios.models.clearThumbnail(key);assert.equal((await service.studios.models.catalog('krea')).items[0].thumbnail,null);
    const datasets=(await gallery.catalog()).filter(x=>x.group==='datasets');assert.equal(datasets.length,1);assert.equal((await gallery.list(datasets[0].id)).total,1);
  }finally{gallery.close();await service.close();await rm(root,{recursive:true,force:true});}
});
