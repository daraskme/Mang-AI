import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { MangaService } from '../src/service.js';
import { startEditor } from '../src/editor-server.js';
import { config, tempRoot, script, bubble } from './fixtures.js';

test('editor tokens are scoped to one DSH session, origin checks reject cross-site writes, stale revisions conflict',async()=>{
  const root=await tempRoot();const s=new MangaService(config(root),{});let editor;
  try{
    const a=s.create('a',{title:'A',brief:'brief'}),b=s.create('b',{title:'B',brief:'brief'});s.setScript('a',{script,revision:1});
    editor=await startEditor(s,0);const credential=new URLSearchParams(new URL(editor.url(a.id)).hash.slice(1)).get('token');
    const base=`${editor.origin}/api/${a.id}`;
    assert.equal((await fetch(base)).status,401);
    const headers={Authorization:`Bearer ${credential}`,'Content-Type':'application/json'};
    assert.equal((await fetch(`${editor.origin}/api/${b.id}`,{headers})).status,401);
    assert.equal((await fetch(base+'/letter',{method:'POST',headers:{...headers,Origin:'https://untrusted.example'},body:'{}'})).status,403);
    const edit={pageId:'p1',revision:2,action:'upsert',bubble};
    assert.equal((await fetch(base+'/letter',{method:'POST',headers,body:JSON.stringify(edit)})).status,200);
    assert.equal((await fetch(base+'/letter',{method:'POST',headers,body:JSON.stringify(edit)})).status,409);
    const state=await(await fetch(base,{headers})).json();assert.equal(state.project.pages[0].bubbles[0].text,bubble.text);
    assert.equal((await fetch(base+'/approve',{method:'POST',headers,body:JSON.stringify({revision:3})})).status,200);
    assert.equal((await fetch(base+'/images/not-owned.png',{headers})).status,404);
    assert.equal((await fetch(editor.origin+'/src/plugin.js')).status,404);
  }finally{if(editor)await editor.close();await s.close();await rm(root,{recursive:true,force:true});}
});
