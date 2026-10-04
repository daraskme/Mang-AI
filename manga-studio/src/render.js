import { LAYOUTS, PAGE_W, PAGE_H } from './model.js';

export const escapeXML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const segments = value => Array.from(new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(value), x=>x.segment);
const noStart = new Set(segments('、。，．？！）」』】〕〉》ぁぃぅぇぉっゃゅょァィゥェォッャュョー々'));
const noEnd = new Set(segments('（「『【〔〈《'));
const paired = new Set(['…','‥','―','—']);

/** Conservative Japanese wrapping. Authored newlines always survive. */
export function wrapText(value, capacity) {
  const lines=[];
  for(const paragraph of value.split('\n')) {
    const chars=segments(paragraph);
    if(!chars.length) {lines.push('');continue;}
    while(chars.length) {
      let end=Math.min(Math.max(1,capacity),chars.length);
      while(end<chars.length && (noStart.has(chars[end]) || (paired.has(chars[end]) && chars[end]===chars[end-1]))) end++;
      while(end>1 && end<chars.length && noEnd.has(chars[end-1])) end--;
      lines.push(chars.splice(0,end).join(''));
    }
  }
  return lines;
}
export function bubbleLayout(b) {
  const inset = ['speech','thought'].includes(b.kind) ? 0.19 : 0.08;
  const w=b.width*(1-2*inset), h=b.height*(1-2*inset);
  const vertical=(b.direction??'vertical')==='vertical';
  const capacity=Math.max(1,Math.floor((vertical?h:w)/b.fontSize));
  const lines=wrapText(b.text,capacity);
  const breadth=lines.length*b.fontSize*1.22;
  const overflow=breadth>(vertical?w:h) || lines.some(l=>segments(l).length*b.fontSize>(vertical?h:w)+1);
  return {lines,overflow,inset,w,h,vertical};
}
export function bubbleSVG(b, interactive=false) {
  const {lines,overflow,inset,vertical}=bubbleLayout(b);
  const cx=b.x+b.width/2,cy=b.y+b.height/2;
  let shape='';
  const stroke='fill="white" stroke="#191919" stroke-width="2.5"';
  if(b.kind==='speech') {
    shape=`<path d="M ${cx-18} ${cy} L ${b.tailX} ${b.tailY} L ${cx+22} ${cy}" ${stroke}/><ellipse cx="${cx}" cy="${cy}" rx="${b.width/2}" ry="${b.height/2}" ${stroke}/>`;
  } else if(b.kind==='thought') {
    shape=`<ellipse cx="${b.tailX}" cy="${b.tailY}" rx="6" ry="6" ${stroke}/><ellipse cx="${(b.tailX+cx)/2}" cy="${(b.tailY+cy)/2}" rx="11" ry="9" ${stroke}/><rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${Math.min(b.width,b.height)*.35}" ${stroke} stroke-dasharray="9 3"/>`;
  } else if(b.kind==='caption') shape=`<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="2" ${stroke}/>`;
  const font='font-family="Noto Sans CJK JP, Noto Sans JP, Yu Gothic, Hiragino Kaku Gothic ProN, sans-serif"';
  const text=lines.map((line,i)=>{
    const x=vertical?cx+(lines.length-1)*b.fontSize*.61-i*b.fontSize*1.22:cx;
    const y=vertical?b.y+b.height*inset:cy-(lines.length-1)*b.fontSize*.61+i*b.fontSize*1.22;
    return `<text x="${x}" y="${y}" lang="ja" ${font} font-size="${b.fontSize}" fill="#151515" ${vertical?'style="writing-mode:vertical-rl;text-orientation:mixed" text-anchor="start"':'text-anchor="middle" dominant-baseline="central"'} xml:space="preserve">${escapeXML(line)}</text>`;
  }).join('');
  const hit=interactive?`<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="transparent" stroke="${overflow?'#d34639':'transparent'}" stroke-width="3" data-hit="${escapeXML(b.id)}"/>`:'';
  return `<g data-bubble="${escapeXML(b.id)}"><title>${escapeXML(b.speaker?b.speaker+'：'+b.text:b.text)}</title>${shape}${text}${hit}</g>`;
}
export function pageSVG(page, images={}, interactive=false) {
  const rects=LAYOUTS[page.layout];
  const panels=page.panels.map((panel,i)=>{
    const [x,y,w,h]=rects[i],clip=`clip-${page.id}-${i}`;
    const source=images[panel.id];
    const content=source?`<image href="${escapeXML(source)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"/>`:`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f0eee9"/><text x="${x+20}" y="${y+38}" fill="#8c877c" font-family="sans-serif" font-size="20">${i+1} / 作画待ち</text>`;
    return `<defs><clipPath id="${clip}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath></defs>${content}<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#191919" stroke-width="3"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE_W} ${PAGE_H}" width="${PAGE_W}" height="${PAGE_H}" role="img" aria-label="${escapeXML(page.purpose)}"><rect width="100%" height="100%" fill="white"/>${panels}${page.bubbles.map(b=>bubbleSVG(b,interactive)).join('')}</svg>`;
}
export function letteringWarnings(project) {
  return project.pages.flatMap(p=>[
    ...p.letteringNeedsReview?[`${p.id}: 脚本が変更されました。保持した吹き出しの内容と位置を確認してください。`]:[],
    ...p.bubbles.filter(b=>bubbleLayout(b).overflow).map(b=>`${p.id}/${b.id}: 文字が吹き出しの内側に収まりません。大きさ・文字サイズ・改行を調整してください。`),
  ]);
}
