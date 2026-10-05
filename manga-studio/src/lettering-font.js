import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packageRoot } from './config.js';

let embedded;
export async function embeddedLetteringFont() {
  if(!embedded)embedded=Promise.all([
    readFile(join(packageRoot,'public/fonts/genei-antique/GenEiAntiqueNv6-M.ttf')),
    readFile(join(packageRoot,'public/fonts/genei-antique/OFLicense.txt'),'utf8'),
  ]).then(([font,license])=>({dataURL:`data:font/ttf;base64,${font.toString('base64')}`,license})).catch(error=>{embedded=undefined;throw error;});
  return embedded;
}
