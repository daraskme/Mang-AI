import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = fileURLToPath(new URL('../', import.meta.url));
export function loadConfig(file = process.env.MANGA_STUDIO_CONFIG || resolve(packageRoot, 'studio.config.json')) {
  let raw;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    file = resolve(packageRoot, 'studio.config.example.json');
    raw = JSON.parse(readFileSync(file, 'utf8'));
  }
  const base = dirname(resolve(file));
  const absolute = value => isAbsolute(value) ? value : resolve(base, value);
  const c = structuredClone(raw);
  if(c.remoteOrigin){const u=new URL(c.remoteOrigin);if(u.protocol!=='https:'||u.origin!==c.remoteOrigin||u.username||u.password)throw Error('remoteOrigin はパスを含まないHTTPSのoriginを指定してください');}
  if(c.remotePort!==undefined&&(!Number.isInteger(c.remotePort)||c.remotePort<1024||c.remotePort>65535))throw Error('remotePort は1024〜65535です');
  c.agent={...c.qwen,...c.agent};
  c.coder={...c.qwen,...c.coder};
  c.gpu={baseURL:'http://127.0.0.1:1234',enabled:false,...c.gpu};
  c.longvideo={baseURL:'http://127.0.0.1:8190',...c.longvideo};
  c.library=absolute(c.library||'../models/training-library.json');
  c.dataDir = absolute(c.dataDir);
  c.krea.backend ||= 'python';
  if(!['python','studio'].includes(c.krea.backend))throw new Error('Krea backend は studio または python です');
  if(c.krea.loraDir)c.krea.loraDir=absolute(c.krea.loraDir);
  c.editing={python:'../upstream/IOpaint/.venv/bin/python',mosaicRepo:'../upstream/mosaic_editor',cacheDir:'../models/editing',wrapper:resolve(packageRoot,'python/run-edit.sh'),timeoutMs:1800000,...c.editing};
  for(const key of ['python','mosaicRepo','cacheDir','wrapper'])if(c.editing[key])c.editing[key]=absolute(c.editing[key]);
  if(!Number.isInteger(c.editing.timeoutMs)||c.editing.timeoutMs<1000||c.editing.timeoutMs>2147483647)throw new Error('編集処理の timeoutMs が不正です');
  c.krea.repo = absolute(process.env.KREA2_REPO || c.krea.repo);
  c.krea.python = absolute(process.env.KREA2_PYTHON || c.krea.python);
  const cli=name=>{const path=resolve(homedir(),'.local/bin',name);return existsSync(path)?path:name;};
  c.externalAgents={codex:cli('codex'),devin:cli('devin'),python:existsSync(c.krea.python)?c.krea.python:'python3',...c.externalAgents};
  for(const key of ['codex','devin','python'])if(c.externalAgents[key].includes('/'))c.externalAgents[key]=absolute(c.externalAgents[key]);
  c.krea.weights = c.krea.weights ? absolute(c.krea.weights) : process.env[c.krea.checkpoint === 'oss_raw' ? 'OSS_RAW' : 'OSS_TURBO'] || '';
  for (const role of ['gemma', 'qwen', 'agent', 'coder']) {
    const prefix = `MANGA_${role.toUpperCase()}`;
    c[role].baseURL = process.env[`${prefix}_URL`] || c[role].baseURL;
    c[role].model = process.env[`${prefix}_MODEL`] || c[role].model;
    const url = new URL(c[role].baseURL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(`${role}: API URL が不正です`);
    if (!c[role].model?.trim()) throw new Error(`${role}: model が必要です`);
    c[role].baseURL = c[role].baseURL.replace(/\/$/, '');
    if (!Number.isInteger(c[role].maxTokens) || c[role].maxTokens < 256) throw new Error(`${role}: maxTokens が不正です`);
  }
  if (!Number.isInteger(c.editorPort) || c.editorPort < 0 || c.editorPort > 65535) throw new Error('editorPort が不正です');
  if (!['oss_raw', 'oss_turbo'].includes(c.krea.checkpoint)) throw new Error('Krea checkpoint は oss_raw または oss_turbo です');
  for (const dim of ['width', 'height']) {
    if (!Number.isInteger(c.krea[dim]) || c.krea[dim] < 256 || c.krea[dim] > 2048 || c.krea[dim] % 16) throw new Error(`Krea ${dim} は 256〜2048 の16の倍数です`);
  }
  for (const [label, n] of [['Gemma timeout', c.gemma.timeoutMs], ['Krea timeout', c.krea.timeoutMs]]) {
    if (!Number.isInteger(n) || n < 1000 || n > 2147483647) throw new Error(`${label} が不正です`);
  }
  if (!Number.isInteger(c.krea.steps) || c.krea.steps < 1 || c.krea.steps > 200 || !Number.isFinite(c.krea.cfg) || c.krea.cfg < 0 || !Number.isFinite(c.krea.mu)) throw new Error('Krea sampling 設定が不正です');
  return c;
}
