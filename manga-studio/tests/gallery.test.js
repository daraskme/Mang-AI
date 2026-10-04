import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {MangaService} from '../src/service.js';
import {startEditor} from '../src/editor-server.js';
import {config,tempRoot,script,png} from './fixtures.js';
import {sessionKey} from '../src/store.js';

test('gallery confines files and captions, paginates, separates edit tokens, and streams video ranges',async()=>{
  const root=await tempRoot('gallery'),c=config(join(root,'sessions')),dataset=join(root,'datasets','sample');
  await mkdir(dataset,{recursive:true});await mkdir(join(root,'models'));c.library=join(root,'models','training-library.json');
  await writeFile(c.library,JSON.stringify({items:[{kind:'dataset',family:'krea2',category:'style',name:'素材',path:dataset,images:2,videos:1,missingLinks:2}]}));
  await writeFile(join(dataset,'first.png'),png);await writeFile(join(dataset,'second.png'),png);await writeFile(join(dataset,'first.txt'),'自然言語のキャプション <script>unsafe()</script>');
  await writeFile(join(dataset,'clip.mp4'),'0123456789');await writeFile(join(root,'secret.txt'),'not a caption');await writeFile(join(root,'secret.png'),png);
  await symlink(join(root,'secret.txt'),join(dataset,'second.txt'));await symlink(join(root,'secret.png'),join(dataset,'outside.png'));await symlink(join(root,'missing.png'),join(dataset,'missing.png'));
  const service=new MangaService(c,{}),editor=await startEditor(service,0);
  try{
    const p=service.create('comic',{title:'進行中の漫画',brief:'ページ表示の確認'});service.setScript('comic',{script,revision:1});
    const key=sessionKey('gallery-test'),params=new URLSearchParams(new URL(editor.galleryUrl(key,'gallery-test')).hash.slice(1));
    const base=`${editor.origin}/api/${key}/gallery/`,headers={Authorization:`Bearer ${params.get('token')}`};
    assert.equal((await fetch(base+'collections')).status,401);
    const catalog=await(await fetch(base+'collections',{headers})).json();assert.equal(catalog.items.length,2);
    const collection=catalog.items.find(x=>x.group==='datasets');assert.equal(collection.missing,2);assert.equal(collection.root,undefined);
    const list=await(await fetch(base+'items?collection='+collection.id,{headers})).json();assert.equal(list.total,3);assert.equal(list.items[0].file,undefined);
    const filtered=await(await fetch(base+'items?collection='+collection.id+'&query=first',{headers})).json();assert.equal(filtered.total,1);
    assert.equal((await(await fetch(base+'items?collection='+collection.id+'&offset=2',{headers})).json()).items.length,1);
    assert.equal((await fetch(base+'items?collection='+collection.id+'&offset=-1',{headers})).status,400);
    const first=list.items.find(x=>x.name==='first.png'),second=list.items.find(x=>x.name==='second.png'),video=list.items.find(x=>x.name==='clip.mp4');
    assert.match((await(await fetch(base+'detail/'+first.id,{headers})).json()).caption,/自然言語/);
    assert.equal((await(await fetch(base+'detail/'+second.id,{headers})).json()).caption,'');
    const range=await fetch(base+'file/'+video.id+'?token='+params.get('token'),{headers:{Range:'bytes=2-5'}});assert.equal(range.status,206);assert.equal(await range.text(),'2345');
    const suffix=await fetch(base+'file/'+video.id,{headers:{...headers,Range:'bytes=-3'}});assert.equal(await suffix.text(),'789');
    assert.equal((await fetch(base+'file/'+video.id,{headers:{...headers,Range:'bytes=20-'}})).status,416);
    assert.equal((await fetch(base+'file/'+video.id+'?path='+encodeURIComponent(join(root,'secret.txt')))).status,401);
    assert.equal((await fetch(`${editor.origin}/api/${key}/generate/status`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'})).status,401);
    assert.equal((await fetch(`${editor.origin}/api/${p.id}`,{headers})).status,401);
    const editToken=new URLSearchParams(new URL(editor.url(key)).hash.slice(1)).get('token');assert.equal((await fetch(base+'collections',{headers:{Authorization:`Bearer ${editToken}`}})).status,401);
    const pages=await(await fetch(base+'items?collection=p-'+p.id,{headers})).json();assert.equal(pages.total,1);
    const page=await fetch(base+'file/'+pages.items[0].id,{headers});assert.equal(page.headers.get('content-type'),'image/svg+xml');assert.match(await page.text(),/<svg/);
    const request={method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id:pages.items[0].id})};
    assert.equal((await fetch(base+'open',{...request,headers:{...request.headers,Origin:'https://foreign.example'}})).status,403);
    const open=await(await fetch(base+'open',request)).json();assert.equal(new URLSearchParams(new URL(open.url).hash.slice(1)).get('project'),p.id);
  }finally{await editor.close();await service.close();await rm(root,{recursive:true,force:true});}
});
