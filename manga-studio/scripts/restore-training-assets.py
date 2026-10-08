"""Restore a pinned Mang-AI private backup, verifying every file before install."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import uuid

REPOS={'loras':('darask0/Mang-AI-LoRA-library','model'),
       'datasets':('darask0/Mang-AI-training-datasets','dataset')}

def safe_path(root,name):
    p=PurePosixPath(name)
    if not name or p.is_absolute() or '\\' in name or any(x in ('..','.git','secrets') for x in p.parts):
        raise ValueError('Unsafe manifest path')
    target=root/Path(*p.parts)
    if not target.resolve().is_relative_to(root.resolve()) or target.resolve()==root.resolve():
        raise ValueError('Manifest path escapes destination')
    return target

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(8*1024*1024),b''): h.update(b)
    return h.hexdigest()

def install(source,destination,record):
    if source.stat().st_size!=record['bytes'] or digest(source)!=record['sha256']:
        raise ValueError('Downloaded file failed SHA-256/size verification')
    if destination.exists():
        if digest(destination)==record['sha256']: return 'already-present'
        raise FileExistsError('Existing file differs; restore to an empty directory')
    destination.parent.mkdir(parents=True,exist_ok=True)
    temp=destination.with_name('.restore-'+uuid.uuid4().hex+'.tmp')
    try:
        shutil.copyfile(source,temp)
        if digest(temp)!=record['sha256']:
            raise ValueError('Copied file failed SHA-256 verification')
        # No overwrite, including if another process creates the path meanwhile.
        os.link(temp,destination)
    finally: temp.unlink(missing_ok=True)
    return 'restored'

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--asset',choices=REPOS,required=True)
    p.add_argument('--destination',type=Path,required=True)
    p.add_argument('--family',choices=['krea2','h3','all'],default='all')
    p.add_argument('--revision',help='Immutable 40-character HF commit SHA')
    p.add_argument('--repo',help='Override the default private repository')
    p.add_argument('--hf-home',type=Path,default=Path.home()/'.cache/huggingface',help='HF credentials/cache directory')
    p.add_argument('--checkpoints',action='store_true',help='Also restore intermediate LoRAs, optimizer states and run configs')
    p.add_argument('--register',action='store_true',help='Merge restored entries into the Mang-AI training library, retaining a backup')
    p.add_argument('--list',action='store_true',help='List counts and bytes without downloading asset files')
    p.add_argument('--local-bundle',type=Path,help='Use a prepared local backup instead of HF')
    a=p.parse_args()
    repo,kind=REPOS[a.asset];repo=a.repo or repo
    if a.local_bundle:
        get=lambda name:safe_path(a.local_bundle,name)
    else:
        if not a.revision or not re.fullmatch('[0-9a-f]{40}',a.revision):
            p.error('--revision must be the pinned commit SHA from the backup receipt')
        os.environ.pop('HF_HUB_OFFLINE',None)
        os.environ['HF_HOME']=str(a.hf_home)
        from huggingface_hub import HfApi,hf_hub_download
        if HfApi().repo_info(repo,repo_type=kind,revision=a.revision).private is not True:
            p.error('Expected a private backup repository')
        def get(name):
            safe_path(Path('/manifest-validation'),name)
            return Path(hf_hub_download(repo,name,repo_type=kind,revision=a.revision))
    manifest=json.loads(get('manifest.json').read_text())
    if manifest.get('schema')!=1 or manifest.get('complete') is not True or manifest.get('private') is not True:
        p.error('Backup is not marked complete/private or has an unsupported schema')
    expected_kind='lora-library' if a.asset=='loras' else 'training-datasets'
    if manifest.get('kind')!=expected_kind: p.error('Backup kind does not match --asset')
    records=[r for r in manifest['records'] if (a.family=='all' or r['family']==a.family)
             and (a.asset=='datasets' or a.checkpoints or r['role']=='lora')]
    root=a.destination.resolve()
    paths=set()
    for r in records:
        safe_path(root,r['path']);safe_path(Path('/manifest-validation'),r['object'])
        if r['path'] in paths: p.error('Duplicate restore path')
        paths.add(r['path'])
        if not re.fullmatch('[0-9a-f]{64}',r['sha256']) or not isinstance(r['bytes'],int) or r['bytes']<0:
            p.error('Invalid object metadata')
    print(json.dumps({'asset':a.asset,'files':len(records),'GiB':round(sum(r['bytes'] for r in records)/2**30,3),
                      'revision':a.revision,'list_only':a.list}),flush=True)
    if a.list: return
    counts={'restored':0,'already-present':0}
    for index,r in enumerate(records):
        status=install(get(r['object']),safe_path(root,r['path']),r);counts[status]+=1
        if (index+1)%1000==0: print(json.dumps({'processed':index+1,'total':len(records)}),flush=True)
    if a.register:
        catalog_file=root/'models/training-library.json'
        catalog_file=safe_path(root,str(catalog_file.relative_to(root)))
        catalog=json.loads(catalog_file.read_text()) if catalog_file.exists() else {'version':1,'items':[]}
        def key(x): return (x['kind'],x['family'],x['name'])
        existing={key(x):x for x in catalog['items']}
        expected='lora' if a.asset=='loras' else 'dataset'
        for item in manifest.get('catalog',{}).get('items',[]):
            if item['kind']!=expected or (a.family!='all' and item['family']!=a.family): continue
            value=item['path']
            if value.startswith('/'): continue
            local=safe_path(root,value)
            if not local.exists(): continue
            updated={**item,'path':str(local)}
            # Resolve known path fields only; never execute downloaded config/state.
            for field in ('trainingRun',):
                if isinstance(updated.get(field),str) and updated[field] and not updated[field].startswith('/'):
                    updated[field]=str(safe_path(root,updated[field]))
            existing[key(item)]=updated
        catalog['items']=list(existing.values());catalog_file.parent.mkdir(parents=True,exist_ok=True)
        if catalog_file.exists():
            backup=root/'work/asset-restore-backups'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
            backup.mkdir(parents=True);shutil.copy2(catalog_file,backup/'training-library.json')
        temp=catalog_file.with_suffix('.json.'+uuid.uuid4().hex+'.tmp')
        temp.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n');os.replace(temp,catalog_file)
    print(json.dumps({'complete':True,**counts}),flush=True)

if __name__=='__main__': main()
