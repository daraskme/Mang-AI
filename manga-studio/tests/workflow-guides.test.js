import test from 'node:test';
import assert from 'node:assert/strict';
import { registerWorkflowGuides } from '../src/workflow-guides.js';
import { registerStudioTools } from '../src/studio-tools.js';
import { LocalStudios } from '../src/local-studios.js';

test('workflow tool returns bounded stages, rejects invalid paths, and discloses unavailable training',async()=>{
  let guide;
  registerWorkflowGuides((name,_description,_parameters,execute)=>{assert.equal(name,'media_workflow_guide');guide=execute;});
  for(const workflow of ['image','video','lora']) {
    const overview=await guide({workflow});
    assert.equal(overview.section,'overview');
    if(workflow==='lora')assert.match(overview.policy,/H3の新規LoRA学習.*未統合/);
    for(const section of overview.sections){
      const result=await guide({workflow,section});
      assert(result.policy.startsWith(`## ${section} — `));
      assert.equal((result.policy.match(/^## /gm)||[]).length,1);
      assert(result.policy.length<3500,`${workflow}/${section} is too large for a single stage`);
      assert.match(result.source,/^manga-studio\/docs\/[a-z-]+\.md$/);
    }
  }
  await assert.rejects(guide({workflow:'../secrets'}),/workflow/);
  await assert.rejects(guide({workflow:'toString'}),/workflow/);
  await assert.rejects(guide({workflow:'image',section:'train'}),/section/);
});

test('H3 or invalid training families cannot reach caption service or create a Krea run',async()=>{
  let prepare;
  const studios=Object.create(LocalStudios.prototype);
  studios.serial=()=>assert.fail('unsupported training must be rejected before queue or service access');
  registerStudioTools((name,_description,_parameters,execute)=>{if(name==='lora_prepare')prepare=execute;},studios);
  await assert.rejects(prepare({family:'h3'},{agent:{id:'test'}}),/H3の新規LoRA学習は未統合/);
  await assert.rejects(prepare({family:'unknown'},{agent:{id:'test'}}),/family/);
});
