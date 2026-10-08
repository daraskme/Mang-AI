const stages={'画像のキャッシュ':[0.02,0.13],'キャプションの埋め込み':[0.15,0.13],'LoRA学習':[0.28,0.70],'保存・検証':[0.98,0.02]};
export function trainingTiming(job,now=Date.now()){
  const elapsed=Math.max(0,((job.finishedAt||now)-job.startedAt)/1000),done=job.state==='completed';
  const [offset,width]=stages[job.phase]||[0,0.02];
  const fraction=job.phaseTotal>0?Math.max(0,Math.min(1,job.phaseStep/job.phaseTotal)):0;
  const progress=done?1:Math.min(.99,offset+width*fraction);
  let etaSeconds=done?0:null;
  const points=(job.progressSamples||[]).slice(-10);
  if(job.state==='running'&&job.phase==='LoRA学習'&&points.length>=3){
    const dt=(points.at(-1)[0]-points[0][0])/1000,steps=points.at(-1)[1]-points[0][1];
    if(dt>=2&&steps>0&&(now-points.at(-1)[0])/1000<=Math.max(120,dt/steps*3)){
      // Include the final save/verification share in the estimate.
      etaSeconds=Math.max(1,Math.ceil((1-progress)*dt/(width*steps/job.totalSteps)));
    }
  }
  return {overallPercent:done?100:Math.min(99,Math.round(progress*100)),elapsedSeconds:Math.round(elapsed),etaSeconds,
    etaNote:'工程配分と実測速度に基づく概算。GPU待ち・モデル読込・保存時間で変動します。'};
}
export function readTrainingProgress(job,text,now=Date.now()){
  if(!job)return;
  const clean=text.replace(/\x1b\[[0-9;]*m/g,'');
  // Unlabelled cache bars and the main "steps:" bar; excludes shard/epoch bars.
  const matches=[...clean.matchAll(/(?:^|[\r\n])(?:steps:\s*)?\s*\d+%\|[^\r\n]*?\|\s*(\d+)\/(\d+)\s*\[/g)];
  for(const match of matches){
    const step=Number(match[1]),total=Number(match[2]);if(total<1||step>total)continue;
    if(job.phase==='LoRA学習'&&total!==job.totalSteps)continue;
    if(job.phaseTotal===total&&step<job.phaseStep)continue;
    if(step===job.phaseStep&&total===job.phaseTotal)continue;
    job.phaseStep=step;job.phaseTotal=total;
    if(job.phase==='LoRA学習')job.step=step;
    job.progressSamples=[...(job.progressSamples||[]),[now,step]].slice(-10);
  }
}
