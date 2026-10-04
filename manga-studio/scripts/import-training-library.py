"""Move the user's existing library after a checksum comparison; retain old paths."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path('/run/media/hiroshi/ボリューム')

def relocate(source, target):
    if source.is_symlink() and source.resolve() == target.resolve():
        return
    if not source.is_dir():
        raise RuntimeError(f'Missing source: {source}')
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.stat().st_dev == target.parent.stat().st_dev:
        if target.exists():
            raise RuntimeError(f'Target already exists: {target}')
        source.rename(target)
        source.symlink_to(target, target_is_directory=True)
        return
    target.mkdir(exist_ok=True)
    subprocess.run(['rsync','-a','--info=stats2','--',str(source)+'/',str(target)+'/'],check=True)
    verify = subprocess.check_output(['rsync','-anic','--delete','--',str(source)+'/',str(target)+'/'])
    if verify.strip():
        raise RuntimeError(f'Checksum comparison differs; originals retained: {source}')
    backup = source.with_name(source.name+'.mang-ai-verified-move')
    if backup.exists():
        raise RuntimeError(f'Prior move backup exists: {backup}')
    source.rename(backup)
    try:
        source.symlink_to(target, target_is_directory=True)
    except Exception:
        backup.rename(source)
        raise
    # rsync checksum verified every copied file, including training checkpoints.
    shutil.rmtree(backup)
    print('Moved and checksum verified:',source,'→',target,flush=True)

def header(path):
    with path.open('rb') as handle:
        size = int.from_bytes(handle.read(8),'little')
        if size > 32*1024*1024:
            raise ValueError('Unexpected SafeTensors header size')
        return json.loads(handle.read(size))

def register():
    records=[]
    for family in ['krea2','h3']:
        output=ROOT/'training-runs'/family/'imported'
        registry=ROOT/('krea2-darask/models/loras/krea2' if family=='krea2' else 'models/h3/loras')
        for folder in sorted(output.iterdir()):
            if not folder.is_dir():
                continue
            weights=list(folder.glob('*.safetensors'))
            finals=[p for p in weights if not __import__('re').search(r'[-_]\d{6,}$',p.stem)]
            if len(finals)!=1:
                records.append({'family':family,'name':folder.name,'kind':'training-run','path':str(folder),'checkpoints':len(weights),'status':'要確認：最終モデルを一意に特定できません'})
                continue
            model=finals[0];h=header(model);meta=h.get('__metadata__',{});keys=[k for k in h if k!='__metadata__']
            valid=any(('lora_unet_blocks_' in k if family=='krea2' else 'diffusion_model.blocks.' in k) and ('lora_A' in k or 'lora_down' in k) for k in keys)
            if not valid:
                raise RuntimeError(f'Unknown LoRA architecture: {model}')
            category='style' if family=='krea2' and '_style' in model.stem else 'concept'
            relative=Path('user')/category/model.name;target=registry/relative;target.parent.mkdir(parents=True,exist_ok=True)
            if not target.exists():
                os.link(model,target)
            elif not os.path.samefile(model,target):
                raise RuntimeError(f'Existing LoRA name collision: {target}')
            trigger=meta.get('trigger','')
            # Preserve explicit training metadata only; don't invent trigger words.
            record={'kind':'lora','family':family,'name':folder.name,'category':category,'path':str(target),'loraId':relative.as_posix(),'trainingRun':str(folder),'checkpoints':len(weights),'trigger':trigger,'status':'registered'}
            if trigger:
                target.with_suffix('.trigger.txt').write_text(trigger+'\n')
            records.append(record)
        datasets=ROOT/'datasets'/family/('imported' if family=='krea2' else 'imported-v2')
        collections=[(category.name,p) for category in datasets.iterdir() if category.is_dir() for p in category.iterdir() if p.is_dir()] if family=='krea2' else [('video',p) for p in datasets.iterdir() if p.is_dir()]
        for category,folder in sorted(collections):
            files=[p for p in folder.rglob('*') if p.is_file()]
            images=sum(p.suffix.lower() in {'.png','.jpg','.jpeg','.webp','.bmp'} for p in files)
            videos=sum(p.suffix.lower() in {'.mp4','.webm','.mkv','.mov'} for p in files)
            captions=sum(p.suffix.lower()=='.txt' for p in files)
            missing=sum(p.is_symlink() and not p.exists() for p in folder.rglob('*'))
            records.append({'kind':'dataset','family':family,'name':folder.name,'category':{'chara':'character'}.get(category,category),'path':str(folder),'images':images,'videos':videos,'captions':captions,'missingLinks':missing,'status':'missing-source' if missing else 'ready'})
    catalog=ROOT/'models/training-library.json';catalog.write_text(json.dumps({'version':1,'items':records},ensure_ascii=False,indent=2)+'\n')
    print('Registered:',sum(x['kind']=='lora' for x in records),'LoRAs,',sum(x['kind']=='dataset' for x in records),'datasets',flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    moves=[]
    for source_name,family in [('H3','h3'),('krea2','krea2')]:
        archive=ROOT/'archives/previous-training'/source_name
        moves += [(SOURCE/source_name,archive),(archive/('datasets_v2' if family=='h3' else 'datasets'),ROOT/'datasets'/family/('imported-v2' if family=='h3' else 'imported')),(archive/'output',ROOT/'training-runs'/family/'imported')]
    for source,target in moves:
        print(source,'→',target,flush=True)
        if args.apply:
            relocate(source,target)
    if args.apply:
        register()
