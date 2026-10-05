import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {MangaService} from '../src/service.js';
import {MediaGallery} from '../src/gallery.js';
import {sessionKey} from '../src/store.js';
import {config,tempRoot,png} from './fixtures.js';

test('catalog thumbnails and per-session model/LoRA selection persist; invalid adapters never replace selection',async()=>{
  const root=await tempRoot('models');let s=new MangaService(config(root),{});
  const catalog=async(_provider,path)=>path==='/api/models'?{items:[{id:'kroma',name:'Kroma',available:true},{id:'missing',available:false}]}:{items:[{id:'style.safetensors',name:'Style',trigger:'ink_lines'},{id:'person.safetensors',name:'人物'}]};
  s.studios.request=catalog;
  try{
    const list=await s.studios.models.catalog('krea',{refresh:true});assert.equal(list.items.length,4);
    const key=list.items[0].key;await s.studios.models.thumbnail(key,'data:image/png;base64,'+png.toString('base64'));
    assert.deepEqual((await s.studios.models.thumbnailFile(key)).bytes,png);
    await assert.rejects(s.studios.models.thumbnail(key,'data:image/jpeg;base64,'+png.toString('base64')),/一致しません/);
    const chosen={provider:'krea',model:'kroma',loras:[{id:'style.safetensors',weight:0.6,role:'style'},{id:'person.safetensors',weight:0.85,role:'character'}]};
    await s.studios.models.select('a',chosen);
    assert.equal(s.studios.models.selected('b','krea'),null);
    await assert.rejects(s.studios.models.select('a',{...chosen,loras:[{id:'unknown',weight:1}]}),/LoRA/);
    assert.equal(s.studios.models.generation('a','krea').loras[0].weight,0.6);
    await s.close();s=new MangaService(config(root),{});
    assert.equal(s.studios.models.selected('a','krea').loras[1].role,'character');
    s.studios.request=async()=>{throw Error('offline');};
    const cached=await s.studios.models.catalog('krea',{refresh:true});assert(cached.cached);assert.equal(cached.items[0].thumbnail.type,'image/png');
    await s.studios.models.select('a',{provider:'krea',model:'kroma',loras:[]});assert.deepEqual(s.studios.models.generation('a','krea').loras,[]);
  }finally{await s.close();await rm(root,{recursive:true,force:true});}
});

test('video works collect only their own generated files and remain isolated by session',async()=>{
  const root=await tempRoot('video-works'),s=new MangaService(config(root),{}),gallery=new MediaGallery(s);
  try{
    const a=s.studios.videoProject('a',{title:'帰り道'}),b=s.studios.videoProject('a',{title:'次の日'});
    const media=s.studios.save('a','media',{provider:'h3',remoteId:'test'}),other=s.studios.save('a','media',{provider:'h3',remoteId:'other'});
    s.studios.attachVideo('a',a.id,media);s.studios.attachVideo('a',b.id,other);
    assert.throws(()=>s.studios.attachVideo('b',a.id,media),/このセッション/);
    const dir=join(s.store.directory(sessionKey('a')),'media');await mkdir(dir,{recursive:true});await writeFile(join(dir,media+'.mp4'),'video');await writeFile(join(dir,other+'.mp4'),'other');
    const list=await gallery.catalog();assert.equal(list.filter(x=>x.group==='videos').length,2);
    const clips=await gallery.list('v-'+a.id);assert.equal(clips.total,1);assert(clips.items[0].name.includes(media));
  }finally{gallery.close();await s.close();await rm(root,{recursive:true,force:true});}
});

test('existing video jobs join a per-session collection once without changing image jobs',async()=>{
  const root=await tempRoot('old-video-works');let s=new MangaService(config(root),{});
  try{
    const video=s.studios.save('old','media',{provider:'h3'});s.studios.save('old','media',{provider:'krea'});
    await s.close();s=new MangaService(config(root),{});
    const first=s.store.db.prepare("SELECT * FROM integrations WHERE kind='video-project'").all();
    assert.equal(first.length,1);assert.equal(first[0].session,sessionKey('old'));assert.deepEqual(JSON.parse(first[0].body).mediaIds,[video]);
    await s.close();s=new MangaService(config(root),{});
    const second=s.store.db.prepare("SELECT * FROM integrations WHERE kind='video-project'").all();assert.equal(second.length,1);assert.equal(second[0].id,first[0].id);
  }finally{await s.close();await rm(root,{recursive:true,force:true});}
});
