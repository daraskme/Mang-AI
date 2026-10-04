import {loadConfig} from '../src/config.js';
import {Store} from '../src/store.js';
import {LocalStudios} from '../src/local-studios.js';
import {writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const config=loadConfig(),store=new Store('.test-output/longvideo-live'),studios=new LocalStudios(config,store,{});
try {
const prompt='A quiet lakeside at dawn. A small red wooden sailboat floats on calm water. Soft watercolor animation, consistent boat and soft morning light, no text.\n\nThe red boat drifts gently to the right. The camera slowly follows it. Soft waves lap against the boat.\n\nThe same boat passes a cluster of reeds. The camera continues its slow pan. Wind rustles the reeds.\n\nThe boat moves toward a distant wooden pier. The camera slowly pulls back. Quiet lake water splashes.';
const ref=await studios.generate('live-longvideo','longvideo',{prompt,seed:42,shot_seconds:6,megapixels:0.2,steps:8,latent_upscale:process.env.TEST_LATENT||'off'});
console.log('Submitted',ref.id,ref.remoteId);await writeFile('.test-output/longvideo-submitted.json',JSON.stringify(ref,null,2));
for(let i=0;i<240;i++) {const r=await studios.job('live-longvideo',ref.id);if(i%6===0||!['queued','running'].includes(r.job.status))console.log(r.job.status,r.job.error||r.outputPath||'');await writeFile('.test-output/longvideo-result.json',JSON.stringify(r,null,2));if(!['queued','running'].includes(r.job.status)){if(r.job.status!=='completed'||(process.env.TEST_LATENT&&r.job.info.join(' ').includes('sampled size')))throw Error(JSON.stringify(r.job));break;}await delay(5000);if(i===239)throw Error('Long-video verification timed out');}
}finally{store.close();}
