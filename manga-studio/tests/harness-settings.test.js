import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {patchSettingsClient} from '../src/harness-settings.js';

const require=createRequire(import.meta.url);
const installed=await readFile(require.resolve('@deepseek-ai/dsh-client-ui-settings/client'),'utf8');
const patched=patchSettingsClient(installed,'0.2.1-alpha.1');

test('the reviewed Harness bundle can be patched repeatedly without changing bytes',()=>{
  assert.equal(patchSettingsClient(patched,'0.2.1-alpha.1'),patched);
  assert.throws(()=>patchSettingsClient(installed,'0.2.2'),/unsupported version/);
  assert.throws(()=>patchSettingsClient(installed+'\n// unexpected modification','0.2.1-alpha.1'),/bundle changed/);
});

// Exercise the actual decision emitted into the pinned bundle. There are no
// authentication grants here: the Host must still accept the settings RPC.
const decision=patched.match(/const persistence = (.+);/)[1];
function persistence({loopback=false,origin='https://studio.example',configured='https://studio.example',protocol='https:'}={}){
  return vm.runInNewContext(decision,{ctx:{remote:{$host:{isLoopback:loopback}}},location:{origin,protocol},__MANGAI_SETTINGS_ORIGIN__:configured});
}
test('host persistence opts in only at the exact configured HTTPS origin',()=>{
  assert.equal(persistence(),'host');
  assert.equal(persistence({origin:'https://other.example'}),'memory');
  assert.equal(persistence({origin:'https://studio.example:8443'}),'memory');
  assert.equal(persistence({origin:'http://studio.example',configured:'http://studio.example',protocol:'http:'}),'memory');
  assert.equal(persistence({configured:null}),'memory');
  assert.equal(persistence({loopback:true,origin:'http://127.0.0.1',protocol:'http:',configured:null}),'host');
});
