"""Install pinned public upstream base models without republishing their weights."""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import uuid

def main():
    here=Path(__file__).resolve()
    spec=importlib.util.spec_from_file_location('asset_restore',here.with_name('restore-training-assets.py'))
    restore=importlib.util.module_from_spec(spec);spec.loader.exec_module(restore)
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--lock',type=Path,default=here.parents[2]/'integrations/base-model-lock.json')
    p.add_argument('--destination',type=Path,default=here.parents[2])
    p.add_argument('--group',action='append',help='Select one or more groups; default: list groups only')
    p.add_argument('--hf-home',type=Path,default=Path.home()/'.cache/huggingface',help='HF credentials/cache directory')
    p.add_argument('--verify-local',action='store_true',help='Verify existing weight hashes without downloads')
    a=p.parse_args();lock=json.loads(a.lock.read_text())
    groups=sorted({r['group'] for r in lock['records']})
    if not a.group:
        for group in groups:
            rows=[r for r in lock['records'] if r['group']==group]
            print(json.dumps({'group':group,'files':len(rows),'GiB':round(sum(r['bytes'] for r in rows)/2**30,2)}))
        return
    if not set(a.group)<=set(groups):p.error('Unknown group')
    root=a.destination.resolve();counts={'verified':0,'downloaded':0,'missing':0,'different':0}
    if not a.verify_local:
        os.environ.pop('HF_HUB_OFFLINE',None)
        os.environ['HF_HOME']=str(a.hf_home)
        from huggingface_hub import hf_hub_download
    for r in (r for r in lock['records'] if r['group'] in a.group):
        target=restore.safe_path(root,r['path'])
        if target.is_file():
            valid=target.stat().st_size==r['bytes'] and (not r['sha256'] or restore.digest(target)==r['sha256'])
            if valid:counts['verified']+=1;continue
            counts['different']+=1
            if a.verify_local:continue
            raise FileExistsError('Existing file differs from pinned upstream; restore to another directory')
        if a.verify_local:counts['missing']+=1;continue
        source=Path(hf_hub_download(r['repo'],r['filename'],revision=r['revision']))
        record={**r,'sha256':r['sha256'] or restore.digest(source)}
        restore.install(source,target,record)
        counts['downloaded']+=1
        print(json.dumps({'group':r['group'],**counts}),flush=True)
    print(json.dumps({'complete':not counts['missing'] and not counts['different'],**counts}),flush=True)
    if counts['different']:raise SystemExit(1)

if __name__=='__main__':main()
