import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {MangaService} from '../src/service.js';
import {startEditor} from '../src/editor-server.js';
import {sessionKey} from '../src/store.js';
import {config,tempRoot,png} from './fixtures.js';

test('same-origin mounted UI preserves session capabilities and durable media references',async()=>{
  const root=await tempRoot('session-media'),c=config(root);c.library=join(root,'library.json');await writeFile(c.library,'{"items":[]}');
  const service=new MangaService(c,{}),editor=await startEditor(service,0);let handler;
  const web=createServer((req,res)=>handler(req,res));await new Promise(resolve=>web.listen(0,'127.0.0.1',resolve));
  const local=`http://127.0.0.1:${web.address().port}`;
  editor.mount({port:web.address().port,register:route=>{handler=route.handler;return()=>{};}},'https://studio.example');
  try{
    for(const session of ['a','b']){const folder=join(service.store.directory(sessionKey(session)),'media');await mkdir(folder,{recursive:true});await writeFile(join(folder,session+'.png'),png);service.studios.save(session,'media',{provider:'krea',remoteId:session});}
    const p=new URLSearchParams(new URL(editor.workspaceUrl(sessionKey('gallery'),'gallery')).hash.slice(1));
    const base=local+'/mang-ai/api/'+p.get('project')+'/gallery/',headers={Authorization:'Bearer '+p.get('token')};
    const api=async(path,body,extra={})=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...headers,...body?{'Content-Type':'application/json'}:{},...extra},...body?{body:JSON.stringify(body)}:{}});assert.equal(r.status,200,await r.clone().text());return r.json();};
    const a=await api('session-media?session=a'),b=await api('session-media?session=b');assert.equal(a.items.length,1);assert.equal(b.items.length,1);assert.notEqual(a.items[0].id,b.items[0].id);
    await api('reference',{session:'a',id:a.items[0].id});assert.equal((await api('session-media?session=b')).reference,null);
    assert.equal(editor.mediaContext('a').reference.file,join(service.store.directory(sessionKey('a')),'media/a.png'));
    assert.throws(()=>editor.mediaContext('b',a.items[0].id),/登録されていない/);
    await api('reference',{session:'a',id:b.items[0].id});assert.equal(editor.mediaContext('a').reference.id,b.items[0].id);assert.equal(editor.mediaContext('a',a.items[0].id).reference.id,a.items[0].id);
    await api('reference',{session:'a',id:null});assert.equal(editor.mediaContext('a').reference,null);assert.equal(editor.mediaContext('a',a.items[0].id).reference.id,a.items[0].id);
    const remote=await new Promise((resolve,reject)=>{const req=request(base+'workspace?session=a',{headers:{...headers,host:'studio.example',origin:'https://studio.example'}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.end();});assert.equal(remote.status,200,remote.body);assert.match(JSON.parse(remote.body).generationUrl,/^https:\/\/studio.example\/mang-ai\/generate.html#/);
    assert.equal((await fetch(base+'session-media?session=a')).status,401);
    const rejected=await new Promise((resolve,reject)=>{const req=request(base+'session-media?session=a',{headers:{...headers,host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(rejected,403);
    assert.equal((await fetch(base+'session-media?session=a',{headers:{...headers,Origin:'https://evil.example'}})).status,403);
    const html=await fetch(local+'/mang-ai/workspace.html').then(r=>r.text());assert.match(html,/src="\.\/workspace.js"/);
    assert.equal((await fetch(local+'/mang-ai/session-media.js')).status,200);
  }finally{await new Promise(resolve=>web.close(resolve));await editor.close();await service.close();await rm(root,{recursive:true,force:true});}
});
