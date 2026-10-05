import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { text } from './model.js';

export const sessionKey = id => createHash('sha256').update(text(id, 'DSH session ID', 500)).digest('hex').slice(0,32);
export const scriptDigest = p => createHash('sha256').update(JSON.stringify({ characters: p.characters, style: p.style, pages: p.pages.map(({id,layout,purpose,panels}) => ({ id,layout,purpose,panels: panels.map(({id,action,artPrompt,dialogue})=>({id,action,artPrompt,dialogue})) })) })).digest('hex');
export class Conflict extends Error { constructor() { super('別の操作で更新されています。再読み込みしてから編集してください'); this.status = 409; } }

/** SQLite transactions retain every project revision; images are immutable files. */
export class Store {
  constructor(root) {
    this.root = resolve(root);
    mkdirSync(this.root, {recursive:true});
    this.db = new DatabaseSync(join(this.root, 'studio.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions (id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(id, revision));
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, project TEXT NOT NULL, body TEXT NOT NULL);`);
  }
  close() { this.db.close(); }
  directory(id) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('プロジェクトIDが不正です');
    return join(this.root, id);
  }
  create(sessionId, {title, brief, characters = '', style = 'Full-color Japanese manga, expressive hand-drawn line art.'}) {
    const id = sessionKey(sessionId);
    if (this.find(id)) throw new Error('このセッションには作品があります。manga_status で再開してください');
    const project = {version:1,id,sessionId,title:text(title,'タイトル',200),brief:text(brief,'依頼',30000),characters,style,pages:[],approved:null,revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    text(style,'画風',4000);
    if (typeof characters !== 'string' || characters.length > 30000) throw new Error('人物設定は30000文字以内です');
    mkdirSync(this.directory(id), {recursive:true});
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const body=JSON.stringify(project);
      this.db.prepare('INSERT INTO projects VALUES (?, ?, ?)').run(id,1,body);
      this.db.prepare('INSERT INTO revisions VALUES (?, ?, ?)').run(id,1,body);
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
    return project;
  }
  find(id) {
    const row=this.db.prepare('SELECT body FROM projects WHERE id=?').get(id);
    return row ? JSON.parse(row.body) : null;
  }
  get(id) { const p=this.find(id); if(!p) throw new Error('manga_create で作品を作成してください'); return p; }
  update(id, expectedRevision, change) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const p=this.get(id);
      if (p.revision!==expectedRevision) throw new Conflict();
      change(p);
      p.revision++; p.updatedAt=new Date().toISOString();
      const body=JSON.stringify(p);
      this.db.prepare('UPDATE projects SET revision=?,body=? WHERE id=?').run(p.revision,body,id);
      this.db.prepare('INSERT INTO revisions VALUES (?,?,?)').run(id,p.revision,body);
      this.db.exec('COMMIT');
      return p;
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  saveJob(job) { this.db.prepare('INSERT INTO jobs VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(job.id,job.project,JSON.stringify(job)); return job; }
  jobs(id) { return this.db.prepare('SELECT body FROM jobs WHERE project=? ORDER BY rowid DESC LIMIT 50').all(id).map(row=>JSON.parse(row.body)); }
  getJob(id) { const row=this.db.prepare('SELECT body FROM jobs WHERE id=?').get(id); if(!row) throw new Error('ジョブが見つかりません'); return JSON.parse(row.body); }
  history(id) {
    this.get(id);
    return this.db.prepare("SELECT revision, json_extract(body,'$.updatedAt') AS updatedAt, json_array_length(body,'$.pages') AS pages FROM revisions WHERE id=? ORDER BY revision DESC LIMIT 100").all(id).map(row=>({...row}));
  }
  restore(id,targetRevision,expectedRevision) {
    const row=this.db.prepare('SELECT body FROM revisions WHERE id=? AND revision=?').get(id,targetRevision);
    if(!row)throw new Error('このセッションの指定版が見つかりません');
    const saved=JSON.parse(row.body);
    return this.update(id,expectedRevision,p=>{
      for(const key of ['title','brief','characters','style','pages'])p[key]=saved[key];
      if(saved.production)p.production=saved.production;else delete p.production;
      p.approved=null;
      for(const page of p.pages)page.letteringNeedsReview=page.bubbles.length>0;
    });
  }
  recoverJobs() {
    for(const row of this.db.prepare('SELECT body FROM jobs').all()) {
      const job=JSON.parse(row.body);
      if (['queued','running'].includes(job.status)) {
        const project=this.get(job.project),completed=[];
        for(const output of job.outputs||[]) {
          if(!/^images\/p\d+-c\d+-[a-f0-9-]+\.png$/.test(output.image)) continue;
          try {
            const bytes=readFileSync(join(this.directory(job.project),output.image));
            if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) completed.push(output);
          } catch(error) {if(error.code!=='ENOENT') throw error;}
        }
        const fresh=scriptDigest(project)===job.digest;
        if(fresh&&completed.length) this.update(project.id,project.revision,p=>{
          const page=p.pages.find(x=>x.id===job.pageId);
          for(const output of completed) {const panel=page?.panels.find(x=>x.id===output.id);if(panel)panel.image=output.image;}
        });
        const status=!fresh?'superseded':completed.length===job.panels.length?'completed':'interrupted';
        this.saveJob({...job,status,completed:completed.map(x=>x.id),error:status==='interrupted'?'DSH が終了しました。完了済み画像を回収しました。未完了コマは再実行できます。':null});
      }
    }
  }
}
