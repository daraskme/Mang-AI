import test from 'node:test';
import assert from 'node:assert/strict';
import {trainingTiming,readTrainingProgress} from '../lib/training-progress.mjs';

test('training ETA uses actual advancing steps, includes all stages, and freezes terminal elapsed time',()=>{
  const j={state:'running',startedAt:1000,phase:'画像のキャッシュ',step:0,totalSteps:100};
  assert.equal(trainingTiming(j,2000).etaSeconds,null);
  readTrainingProgress(j,'50%|#####     | 5/10 [00:10<00:10]',11000);
  assert.equal(trainingTiming(j,11000).overallPercent,9);
  Object.assign(j,{phase:'LoRA学習',phaseStep:0,phaseTotal:0,progressSamples:[]});
  readTrainingProgress(j,'Loading checkpoint shards: 100%|##| 3/3 [00:01<00:00]',20000);assert.equal(j.step,0);
  for(let n=1;n<=3;n++)readTrainingProgress(j,`steps: ${n}%|#| ${n}/100 [00:01<01:00]`,20000+n*2000);
  const t=trainingTiming(j,26000);assert.equal(j.step,3);assert(t.etaSeconds>194);assert.equal(t.overallPercent,30);
  assert.equal(trainingTiming(j,200000).etaSeconds,null);
  Object.assign(j,{state:'error',finishedAt:30000});assert.equal(trainingTiming(j,999999).elapsedSeconds,29);assert.equal(trainingTiming(j).etaSeconds,null);
  j.state='completed';assert.equal(trainingTiming(j).overallPercent,100);assert.equal(trainingTiming(j).etaSeconds,0);
});
