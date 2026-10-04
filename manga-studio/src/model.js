export const PAGE_W = 1000;
export const PAGE_H = 1414;
// Rectangles follow Japanese reading order. Values are page coordinates.
export const LAYOUTS = {
  '縦2（上大）': [[28,28,944,840],[28,884,944,502]],
  '縦2（下大）': [[28,28,944,502],[28,546,944,840]],
  '上横長＋右下大＋左下インセット': [[28,28,944,470],[356,514,616,872],[28,514,312,570]],
  '上大＋下2': [[28,28,944,780],[508,824,464,562],[28,824,464,562]],
  '縦3（中大）': [[28,28,944,310],[28,354,944,676],[28,1046,944,340]],
  '2×2（下段大小）': [[508,28,464,570],[28,28,464,570],[348,614,624,772],[28,614,304,772]],
  '左2＋右縦長＋下横長': [[28,28,350,430],[28,474,350,430],[394,28,578,876],[28,920,944,466]],
  '2×2': [[508,28,464,671],[28,28,464,671],[508,715,464,671],[28,715,464,671]],
  '縦4': [[28,28,944,270],[28,314,944,300],[28,630,944,350],[28,996,944,390]],
};
export function text(value, label, max = 20000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label}: 1〜${max}文字で入力してください`);
  return value;
}
export function integer(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label}: ${min}〜${max}の整数が必要です`);
  return value;
}
export function normalizeScript(value) {
  if (!value || !Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 32) throw new Error('脚本は pages 配列（1〜32ページ）を持つ JSON にしてください');
  let previous;
  return value.pages.map((page, index) => {
    if (!LAYOUTS[page.layout]) throw new Error(`ページ${index + 1}: 未知のコマ割りです`);
    if (previous === page.layout) throw new Error('隣接ページで同じコマ割りを続けないでください');
    previous = page.layout;
    if (!Array.isArray(page.panels) || page.panels.length !== LAYOUTS[page.layout].length) throw new Error(`ページ${index + 1}: コマ数がレイアウトと一致しません`);
    return {
      id: `p${index + 1}`, layout: page.layout, purpose: text(page.purpose, 'ページの目的', 1000),
      panels: page.panels.map((panel, p) => {
        if (!Array.isArray(panel.dialogue || []) || (panel.dialogue || []).length > 2) throw new Error('1コマの台詞は0〜2本です');
        return ({
        id: `p${index + 1}-c${p + 1}`, action: text(panel.action, '画面内の動作', 3000),
        artPrompt: text(panel.artPrompt, '英語の作画指示', 6000),
        dialogue: (panel.dialogue || []).map(d => ({ speaker: text(d.speaker, '話者', 120), text: text(d.text, '台詞', 500) })),
        image: null,
      });}),
      bubbles: [],
    };
  });
}
export function replaceScript(project, pages) {
  project.pages = pages.map(page => {
    const old = project.pages.find(p => p.id === page.id);
    if (!old) return page;
    page.bubbles = old.bubbles;
    page.letteringNeedsReview = page.bubbles.length > 0;
    for (const panel of page.panels) {
      const before = old.panels.find(p => p.id === panel.id);
      if (before?.artPrompt === panel.artPrompt && before?.action === panel.action && old.layout === page.layout) panel.image = before.image;
    }
    return page;
  });
  project.approved = null;
}
export function validateBubble(b) {
  if (!b || typeof b !== 'object') throw new Error('吹き出しが不正です');
  if (!['speech','thought','caption','text'].includes(b.kind)) throw new Error('吹き出し種別が不正です');
  if (!['vertical','horizontal'].includes(b.direction)) throw new Error('文字方向が不正です');
  const out = { id: text(b.id, '吹き出しID', 80), kind: b.kind, direction: b.direction, text: text(b.text, '本文', 1000), speaker: typeof b.speaker === 'string' ? b.speaker.slice(0,120) : '' };
  if (!/^[a-zA-Z0-9_-]+$/.test(out.id)) throw new Error('吹き出しIDは英数字、ハイフン、アンダースコアのみです');
  for (const [key,min,max] of [['x',0,PAGE_W],['y',0,PAGE_H],['width',60,PAGE_W],['height',60,PAGE_H],['fontSize',12,100],['tailX',0,PAGE_W],['tailY',0,PAGE_H]]) {
    const n = b[key];
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${key}: ${min}〜${max}で入力してください`);
    out[key] = Math.round(n * 100) / 100;
  }
  if (out.x + out.width > PAGE_W || out.y + out.height > PAGE_H) throw new Error('吹き出しがページ外にはみ出しています');
  return out;
}
export function getPage(project, pageId) {
  const page = project.pages.find(p => p.id === pageId);
  if (!page) throw new Error('ページが見つかりません');
  return page;
}
export function editLettering(project, { pageId, action, bubble, id }) {
  const page = getPage(project, pageId);
  if (action === 'delete') {
    if (!page.bubbles.some(b => b.id === id)) throw new Error('吹き出しが見つかりません');
    page.bubbles = page.bubbles.filter(b => b.id !== id);
  } else if (action === 'upsert') {
    const value = validateBubble(bubble);
    const index = page.bubbles.findIndex(b => b.id === value.id);
    if (index < 0) {
      if (page.bubbles.length >= 32) throw new Error('吹き出しは1ページ32個までです');
      page.bubbles.push(value);
    } else page.bubbles[index] = value;
  } else throw new Error('action は upsert または delete です');
}
