import test from 'node:test';
import assert from 'node:assert/strict';
import {rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {MangaService} from '../src/service.js';
import {startEditor} from '../src/editor-server.js';
import {config,tempRoot,script} from './fixtures.js';
import {sessionKey} from '../src/store.js';

test('unified workspace filters the selected session, keeps capabilities separate, and only permits configured GUI frames',async()=>{
  const root=await tempRoot('workspace'),c=config(root);c.library=join(root,'library.json');await writeFile(c.library,'{"items":[]}');
  const service=new MangaService(c,{}),editor=await startEditor(service,0);
  try{
    for(const id of ['session-a','session-b']){service.create(id,{title:id,brief:'試験'});service.setScript(id,{script,revision:1});}
    const url=new URL(editor.workspaceUrl(sessionKey('gallery'),'gallery')),params=new URLSearchParams(url.hash.slice(1));
    const base=`${editor.origin}/api/${params.get('project')}/gallery/`,headers={Authorization:`Bearer ${params.get('token')}`};
    const get=async path=>(await fetch(base+path,{headers})).json();
    assert.equal((await fetch(base+'workspace?session=session-a')).status,401);
    assert.equal((await get('collections')).items.length,2);
    assert.deepEqual((await get('collections?session=session-a')).items.map(c=>c.id),['p-'+sessionKey('session-a')]);
    assert.deepEqual((await get('progress?session=session-b')).items.map(c=>c.id),[sessionKey('session-b')]);
    assert.deepEqual((await get('progress?session=new-session')).items,[]);
    const context=await get('workspace?session=session-a');assert.equal(context.title,'session-a');assert.equal(new URLSearchParams(new URL(context.editorUrl).hash.slice(1)).get('project'),sessionKey('session-a'));
    assert.equal((await get('workspace?session=new-session')).editorUrl,null);
    assert.equal((await fetch(`${editor.origin}/api/${sessionKey('session-a')}`,{headers})).status,401);
    assert.throws(()=>editor.allowFrameOrigin('https://foreign.example'));
    editor.allowFrameOrigin('http://127.0.0.1:8765');
    const response=await fetch(url),policy=response.headers.get('content-security-policy');
    assert.match(policy,/frame-ancestors 'self' http:\/\/127\.0\.0\.1:8765/);assert.doesNotMatch(policy,/\*/);
    assert.equal((await fetch(base+'workspace',{headers:{...headers,Origin:'http://127.0.0.1:8765'}})).status,403);
  }finally{await editor.close();await service.close();await rm(root,{recursive:true,force:true});}
});
