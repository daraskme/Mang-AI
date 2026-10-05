import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScript, editLettering, replaceScript } from '../src/model.js';
import { balloonInstruction, usesDrawnBalloon } from '../src/balloons.js';
import { pageSVG } from '../src/render.js';
import { script, bubble } from './fixtures.js';

test('empty balloon prompts match speaker counts without sending dialogue text to Krea',()=>{
  const page=normalizeScript(script)[0],panel=page.panels[0];
  const prompt=balloonInstruction(page,panel,'generated');
  assert.match(prompt,/exactly 1 completely EMPTY/);assert(!prompt.includes('紗季'));
  assert(!prompt.includes(panel.dialogue[0].text));assert.match(prompt,/No lettering/);
  panel.dialogue=[];assert.match(balloonInstruction(page,panel,'generated'),/Silent panel, no speech bubbles/);
  page.bubbles=[{...bubble,kind:'thought'}];assert.match(balloonInstruction(page,panel,'generated'),/thought cloud/);
  assert.match(balloonInstruction(page,panel,'overlay'),/no speech bubbles/);
});

test('art balloons suppress duplicate outlines, retain text, and preserve legacy/manual choices',()=>{
  const project={pages:normalizeScript(script)},page=project.pages[0];
  editLettering(project,{pageId:'p1',action:'upsert',bubble});
  assert.equal(usesDrawnBalloon(page,page.bubbles[0]),false);
  page.panels[0].image='art.png';page.panels[0].balloonMode='generated';
  assert.equal(usesDrawnBalloon(page,page.bubbles[0]),true);
  const group=pageSVG(page).split('<g data-bubble=')[1];
  assert(!group.includes('<ellipse'));assert(!group.includes('<path'));assert(group.includes(bubble.text));
  editLettering(project,{pageId:'p1',action:'upsert',bubble:{...bubble,shape:'overlay'}});
  assert.equal(usesDrawnBalloon(page,page.bubbles[0]),false);
  assert(pageSVG(page).includes('<ellipse'));
  editLettering(project,{pageId:'p1',action:'upsert',bubble:{...bubble,text:'文字修正'}});
  assert.equal(page.bubbles[0].shape,'overlay');
  assert.throws(()=>editLettering(project,{pageId:'p1',action:'upsert',bubble:{...bubble,shape:'unknown'}}),/枠/);
});

test('unchanged scripts retain image balloon provenance; changed dialogue invalidates generated balloons',()=>{
  const project={pages:normalizeScript(script)},page=project.pages[0];
  page.panels[0].image='art.png';page.panels[0].balloonMode='generated';
  replaceScript(project,normalizeScript(script));assert.equal(project.pages[0].panels[0].balloonMode,'generated');
  const changed=structuredClone(script);changed.pages[0].panels[0].dialogue.push({speaker:'悠',text:'ありがとう。'});
  replaceScript(project,normalizeScript(changed));assert.equal(project.pages[0].panels[0].image,null);
});
