"""Create resumable AVIF training copies and matching captions; retain originals."""
from __future__ import annotations
import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import io
import json
import math
import os
from pathlib import Path
import shutil
import time
from PIL import Image, ImageChops, ImageCms, ImageOps, ImageStat, features

IMAGE_EXTS={'.png','.jpg','.jpeg','.webp','.bmp','.avif','.gif'}

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(4*1024*1024),b''): h.update(block)
    return h.hexdigest()

def atomic_json(path,data):
    tmp=path.with_name(path.name+'.tmp')
    tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    os.replace(tmp,path)

def copy_caption(source,relative,target,out):
    caption=source.with_suffix('.txt')
    destination=target.with_suffix('.txt')
    if not caption.is_file():
        # This path is inside our recipe-owned output directory only.
        if destination.exists(): destination.unlink()
        return None
    data=caption.read_bytes()
    tmp=destination.with_name(destination.name+'.tmp')
    tmp.write_bytes(data);os.replace(tmp,destination)
    return {'source':str(Path(relative).with_suffix('.txt')),'target':str(destination.relative_to(out)),
            'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}

def convert(job):
    source,relative,out,recipe,prior=job
    source=Path(source);out=Path(out)
    before=source.stat();source_sha=sha(source)
    if prior and prior.get('source_sha256')==source_sha:
        target=out/prior['target']
        if target.is_file() and sha(target)==prior['sha256']:
            caption=copy_caption(source,relative,target,out) if prior.get('training_image') else None
            updated={**prior,'reused':True}
            if prior.get('training_image'): updated['caption']=caption
            return updated
    with Image.open(source) as opened:
        frames=getattr(opened,'n_frames',1)
        if frames!=1:
            # Training Image.open().convert('RGB') reads a single frame. Preserve
            # animation separately rather than silently training an arbitrary frame.
            target=out/'animations'/relative
            target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(source,target)
            return {'source':relative,'target':str(target.relative_to(out)),'source_sha256':source_sha,
                    'sha256':source_sha,'source_bytes':before.st_size,'bytes':before.st_size,
                    'frames':frames,'status':'animation_preserved','training_image':False}
        opened.load()
        img=ImageOps.exif_transpose(opened)
        original_size=list(img.size)
        alpha='A' in img.getbands() or 'transparency' in img.info
        mode='RGBA' if alpha else 'RGB'
        icc=img.info.get('icc_profile')
        if img.mode not in ('RGB','RGBA') and icc and img.mode in ('CMYK','LAB'):
            img=ImageCms.profileToProfile(img,ImageCms.ImageCmsProfile(io.BytesIO(icc)),ImageCms.createProfile('sRGB'),outputMode=mode)
            icc=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
        else:
            if img.mode not in ('RGB','RGBA','P','L','LA'): icc=None
            img=img.convert(mode)
        if max(img.size)>recipe['max_edge']:
            img.thumbnail((recipe['max_edge'],recipe['max_edge']),Image.Resampling.LANCZOS)
        needs_alpha = alpha and img.getchannel('A').getextrema() != (255,255)
        target=out/'images'/Path(relative).with_name(Path(relative).name+'.avif')
        target.parent.mkdir(parents=True,exist_ok=True)
        tmp=target.with_name(target.name+'.tmp')
        options={'format':'AVIF','quality':recipe['quality'],'subsampling':'4:4:4','speed':recipe['speed'],'max_threads':1}
        if icc: options['icc_profile']=icc
        img.save(tmp,**options)
        with Image.open(tmp) as restored:
            restored.load()
            assert restored.size==img.size and max(restored.size)<=recipe['max_edge']
            assert getattr(restored,'n_frames',1)==1
            # AVIF may omit a uniformly opaque alpha plane without data loss.
            assert not needs_alpha or 'A' in restored.getbands()
            # Diagnostic only: this is not a perceptual quality or LoRA score.
            difference=ImageChops.difference(img.convert('RGB'),restored.convert('RGB'))
            mse=sum(ImageStat.Stat(difference).sum2)/(3*img.width*img.height)
            psnr=round(10*math.log10(255**2/mse),3) if mse else None
        after=source.stat()
        if (before.st_mtime_ns,before.st_size)!=(after.st_mtime_ns,after.st_size):
            tmp.unlink();raise RuntimeError('Source changed during conversion')
        os.replace(tmp,target)
        caption_record=copy_caption(source,relative,target,out)
        return {'source':relative,'target':str(target.relative_to(out)),'source_sha256':source_sha,
                'sha256':sha(target),'source_bytes':before.st_size,'bytes':target.stat().st_size,
                'source_size':original_size,'size':list(img.size),'alpha':alpha,'frames':1,
                'status':'converted','training_image':True,'caption':caption_record,'psnr_rgb_db':psnr}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--max-edge',type=int,default=2048)
    parser.add_argument('--quality',type=int,default=95)
    parser.add_argument('--speed',type=int,default=6)
    parser.add_argument('--workers',type=int,default=6)
    parser.add_argument('--limit',type=int)
    args=parser.parse_args()
    if not 1<=args.quality<=100 or args.max_edge<64 or not 0<=args.speed<=10 or not 1<=args.workers<=16:
        parser.error('invalid codec parameters')
    if not features.check('avif'): parser.error('Pillow requires an AVIF encoder/decoder')
    source=args.source.resolve();out=args.output.resolve()
    if source==out or source in out.parents or out in source.parents:
        parser.error('source and output must be separate non-nested trees')
    recipe={'schema':1,'format':'AVIF','max_edge':args.max_edge,'quality':args.quality,'speed':args.speed,
            'subsampling':'4:4:4','orientation':'exif_transpose','originals':'unchanged',
            'pillow':Image.__version__,'source_root':str(source)}
    out.mkdir(parents=True,exist_ok=True)
    recipe_path=out/'recipe.json'
    if recipe_path.exists():
        if json.loads(recipe_path.read_text())!=recipe: parser.error('output recipe differs; choose a new output directory')
    elif any(out.iterdir()): parser.error('refusing non-empty output without recipe')
    else: atomic_json(recipe_path,recipe)
    ledger=out/'records.jsonl';prior={}
    if ledger.exists():
        for line in ledger.read_text().splitlines():
            if not line.strip(): continue
            rec=json.loads(line);prior[rec['source']]=rec
    files=sorted(p for p in source.rglob('*') if p.suffix.lower() in IMAGE_EXTS and p.is_file())
    if args.limit: files=files[:args.limit]
    jobs=[(str(p),str(p.relative_to(source)),str(out),recipe,prior.get(str(p.relative_to(source)))) for p in files]
    started=time.monotonic();results=[];errors=[];last=0
    with ledger.open('a') as log,(out/'errors.jsonl').open('w') as error_log,ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures={pool.submit(convert,job):job[1] for job in jobs}
        for future in as_completed(futures):
            relative=futures[future]
            try:
                rec=future.result();results.append(rec)
                log.write(json.dumps(rec,ensure_ascii=False)+'\n');log.flush()
            except Exception as e:
                error={'source':relative,'type':type(e).__name__,'error':str(e)[:250]}
                errors.append(error)
                error_log.write(json.dumps(error,ensure_ascii=False)+'\n');error_log.flush()
            elapsed=time.monotonic()-started
            if elapsed-last>=20 or len(results)+len(errors)==len(files):
                status={'completed':len(results),'total':len(files),'errors':len(errors),'elapsed_s':round(elapsed,1),
                        'source_GiB':round(sum(x['source_bytes'] for x in results)/2**30,3),
                        'output_GiB':round(sum(x['bytes'] for x in results)/2**30,3)}
                atomic_json(out/'progress.json',status);print(json.dumps(status),flush=True);last=elapsed
    manifest={'created_utc':datetime.now(timezone.utc).isoformat(),'recipe':recipe,
              'records':sorted(results,key=lambda x:x['source']),'errors':errors,
              'elapsed_seconds':time.monotonic()-started,'complete':not errors and args.limit is None}
    atomic_json(out/('sample-manifest.json' if args.limit else 'manifest.json'),manifest)
    if errors: raise SystemExit(1)

if __name__=='__main__': main()
