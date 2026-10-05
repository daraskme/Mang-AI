import { LAYOUTS } from './model.js';

export function panelAtBubble(page,bubble) {
  const cx=bubble.x+bubble.width/2,cy=bubble.y+bubble.height/2;
  return page.panels.find((_,i)=>{const [x,y,w,h]=LAYOUTS[page.layout][i];return cx>=x&&cx<=x+w&&cy>=y&&cy<=y+h;});
}

export function usesDrawnBalloon(page,bubble) {
  if(!['speech','thought'].includes(bubble.kind))return false;
  if(bubble.shape==='art')return true;
  if(bubble.shape==='overlay')return false;
  const panel=panelAtBubble(page,bubble);
  return !!panel?.image&&panel.balloonMode==='generated';
}

/** Geometry is a suggested area; a generated balloon still needs visual alignment. */
export function balloonInstruction(page,panel,mode) {
  if(mode!=='generated')return 'Artwork only, no lettering, no speech bubbles, no captions, no written words, no watermark. Leave breathing room for separate lettering.';
  const [x,y,w,h]=LAYOUTS[page.layout][page.panels.findIndex(p=>p.id===panel.id)];
  const placed=page.bubbles.filter(b=>['speech','thought'].includes(b.kind)&&panelAtBubble(page,b)?.id===panel.id);
  const balloons=placed.length?placed:(panel.dialogue||[]).map((line,i)=>{
    const width=Math.min(185,w-32),height=Math.min(280,h-32);
    return {speaker:line.speaker,kind:'speech',x:i%2===0?x+w-width-14:x+14,y:y+16,width,height};
  });
  if(!balloons.length)return 'Silent panel, no speech bubbles. No lettering, no written words, no captions, no watermark.';
  // Names, dialogue and labels can be copied into the image even with a no-text instruction.
  const locations=balloons.map((b,i)=>`Balloon ${i+1}: ${b.kind==='thought'?'thought cloud':'speech balloon'}, approximately centered at ${Math.round((b.x+b.width/2-x)/w*100)}% from the left and ${Math.round((b.y+b.height/2-y)/h*100)}% from the top, width ${Math.round(b.width/w*100)}%, height ${Math.round(b.height/h*100)}% of the panel.`);
  return `Draw exactly ${balloons.length} completely EMPTY manga balloons as part of the artwork, with hand-drawn contours matching its linework. Draw only the border and tail, surrounding a pure white, featureless, unmarked interior. ${locations.join(' ')} Keep faces and important gestures visible. Speech tails point to the speaking characters; arrange balloons in right-to-left reading order. No lettering, no names or labels, no characters or symbols inside the balloons, no written words, no captions, no watermark. This balloon instruction takes precedence over earlier requests to omit bubbles.`;
}
