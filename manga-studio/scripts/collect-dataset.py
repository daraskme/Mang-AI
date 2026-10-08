"""Collect bounded image sets with provenance, deduplication and AVIF copies."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import http.cookiejar
import importlib.util
import json
import logging
import os
from pathlib import Path
import re
import signal
import sys
import time
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

ROOT=Path(__file__).resolve().parents[2]
SITES={'x':('x.com','www.x.com','twitter.com','www.twitter.com'),
       'pixiv':('pixiv.net','www.pixiv.net'),
       'gelbooru':('gelbooru.com','www.gelbooru.com'),
       'pawchive':('pawchive.pw','www.pawchive.pw')}
MEDIA={'x':('twimg.com',),'pixiv':('pximg.net',),
       'gelbooru':('gelbooru.com',),'pawchive':('pawchive.pw',)}
IMAGE_EXTS={'jpg','jpeg','png','webp','avif','bmp','gif'}
SECRET_KEYS={'token','api_key','api-key','password','auth','authorization','key'}

class LimitReached(BaseException):pass
class Cancelled(BaseException):pass

def clean_url(value):
    u=urlsplit(value)
    return urlunsplit((u.scheme,u.netloc,u.path,urlencode([(k,v) for k,v in parse_qsl(u.query) if k.lower() not in SECRET_KEYS]),''))

def source_site(url):
    u=urlsplit(url)
    if u.scheme!='https' or u.username or u.password or u.port not in (None,443):
        raise ValueError('Use an HTTPS site URL without embedded credentials')
    if any(k.lower() in SECRET_KEYS for k,_ in parse_qsl(u.query)):
        raise ValueError('Put credentials in the local config file, not in URLs')
    for site,hosts in SITES.items():
        if u.hostname in hosts:return site
    raise ValueError('Supported sites: X, Pixiv, Gelbooru, Pawchive')

def media_url(url,site):
    u=urlsplit(url)
    if u.scheme!='https' or u.username or u.password or u.port not in (None,443):raise ValueError('Invalid media URL')
    if not any(u.hostname==d or (u.hostname or '').endswith('.'+d) for d in MEDIA[site]):
        raise ValueError('Media host is outside the selected site CDN')
    return url

def validate_spec(spec):
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}',spec.get('dataset','')):
        raise ValueError('Dataset name must be a short alphanumeric slug')
    urls=spec.get('urls')
    if not isinstance(urls,list) or not 1<=len(urls)<=20:raise ValueError('Supply 1 to 20 URLs')
    sites=[source_site(u) for u in urls]
    limit=spec.get('limit',100)
    if type(limit) is not int or not 1<=limit<=1000:raise ValueError('limit must be 1..1000 image candidates')
    return {**spec,'limit':limit,'sites':sites}

def atomic_json(path,data):
    temp=path.with_name('.collector-state-'+str(os.getpid())+'.tmp')
    temp.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');os.replace(temp,path)

def credentials(path):
    if not path.exists():return {}
    if path.stat().st_mode & 0o077:raise ValueError('Credential config must have mode 0600')
    value=json.loads(path.read_text())
    if not isinstance(value,dict):raise ValueError('Invalid credential config')
    return value

def load_runtime(root):
    sys.path.insert(0,str(root/'upstream/dataset-collector-runtime'))
    import requests
    from gallery_dl import config,job,extractor,version
    return requests,config,job,extractor,version

def get_json(session,url,**kwargs):
    with session.get(url,timeout=(10,30),allow_redirects=False,stream=True,**kwargs) as response:
        if response.status_code in (401,403):raise RuntimeError('Site login/access is required; no bypass attempted')
        if response.status_code==429:raise RuntimeError('Rate limited; stop and retry later')
        response.raise_for_status()
        if response.is_redirect:raise RuntimeError('Unexpected API redirect')
        data=bytearray()
        for chunk in response.iter_content(65536):
            data.extend(chunk)
            if len(data)>16*1024*1024:raise RuntimeError('API response too large')
        return json.loads(data)

def pawchive_posts(url,session,max_pages=20):
    # Kemono-compatible creator/post API. Validate against the authenticated site
    # before relying on it: public schema access returned HTTP 403 during setup.
    match=re.fullmatch(r'/(patreon|fanbox|discord)/user/([^/]+)(?:/post/([^/]+))?/?',urlsplit(url).path)
    if not match:raise ValueError('Pawchive requires a creator or individual post URL')
    service,user,post=match.groups()
    if not re.fullmatch(r'[A-Za-z0-9_-]+',user) or (post and not re.fullmatch(r'[A-Za-z0-9_-]+',post)):
        raise ValueError('Invalid Pawchive creator/post identifier')
    base=f'https://pawchive.pw/api/v1/{service}/user/{user}'
    if post:
        data=get_json(session,base+'/post/'+post)
        yield data.get('post',data);return
    for page in range(max_pages):
        data=get_json(session,base+'/posts',params={'o':page*50})
        rows=data.get('posts',[]) if isinstance(data,dict) else data
        if not isinstance(rows,list):raise ValueError('Unexpected Pawchive API schema')
        yield from rows
        if len(rows)<50:return
        time.sleep(2)

def pawchive_images(post):
    for item in [post.get('file')]+post.get('attachments',[]):
        if not isinstance(item,dict) or not item.get('path'):continue
        url=item['path']
        if url.startswith('/'):
            url='https://pawchive.pw'+(url if url.startswith('/data/') else '/data'+url)
        extension=Path(urlsplit(url).path).suffix.lstrip('.').lower()
        if extension in IMAGE_EXTS:
            yield media_url(url,'pawchive'),{'id':str(post.get('id','')),'user':str(post.get('user','')),
                                          'extension':extension,'title':str(post.get('title',''))[:300]}

class Collector:
    def __init__(self,root,spec,auth,status_path):
        self.root=root;self.spec=validate_spec(spec);self.auth=auth;self.status_path=status_path
        self.base=root/'datasets/incoming'/self.spec['dataset']
        if not self.base.resolve().is_relative_to(root.resolve()):raise ValueError('Dataset path escapes root')
        self.base.mkdir(parents=True,exist_ok=True)
        import fcntl
        self.lock=(self.base/'.collector.lock').open('a')
        fcntl.flock(self.lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        self.raw=self.base/'originals';self.raw.mkdir(exist_ok=True)
        self.prepared=self.base/'prepared';self.prepared.mkdir(exist_ok=True)
        self.state={'state':'running','dataset':self.spec['dataset'],'limit':self.spec['limit'],
                    'candidates':0,'downloaded':0,'duplicates':0,'failed':0,'skipped':0,
                    'folder':str(self.prepared/'images'),'originals':str(self.raw),'errors':{},'pid':os.getpid()}
        self.requests,self.gconfig,self.Job,self.extractor,self.version=load_runtime(root)
        specmod=importlib.util.spec_from_file_location('avif_converter',Path(__file__).with_name('optimize-training-images.py'))
        self.converter=importlib.util.module_from_spec(specmod);specmod.loader.exec_module(self.converter)
        self.sessions={};self.seen=set();self.scanned=0
        ledger=self.base/'provenance.jsonl'
        if ledger.exists():
            for line in ledger.read_text().splitlines():
                row=json.loads(line);self.seen.add((row['source_url'],row['sha256']))
        self.ledger=ledger
        self.save()

    def save(self):
        self.state['updated_utc']=datetime.now(timezone.utc).isoformat();atomic_json(self.status_path,self.state)

    def session(self,site):
        if site not in self.sessions:
            session=self.requests.Session();session.trust_env=False
            session.headers.update({'User-Agent':'Mang-AI-DatasetCollector/1.0','Referer':'https://'+SITES[site][0]+'/'})
            path=self.auth.get(site,{}).get('cookies_file')
            if path:
                jar=http.cookiejar.MozillaCookieJar(str(Path(path).expanduser()))
                jar.load(ignore_discard=True,ignore_expires=False);session.cookies.update(jar)
            self.sessions[site]=session
        return self.sessions[site]

    def fetch_file(self,url,site,temp):
        session=self.session(site)
        for _ in range(5):
            media_url(url,site)
            with session.get(url,stream=True,timeout=(10,40),allow_redirects=False) as response:
                if response.is_redirect:
                    from urllib.parse import urljoin
                    url=urljoin(url,response.headers['Location']);continue
                if response.status_code in (401,403,429):raise RuntimeError('Media access denied or rate limited')
                response.raise_for_status()
                size=0;h=hashlib.sha256()
                with temp.open('xb') as f:
                    for chunk in response.iter_content(65536):
                        size+=len(chunk)
                        if size>40*1024*1024:raise ValueError('Image exceeds 40 MiB')
                        f.write(chunk);h.update(chunk)
                return h.hexdigest()
        raise RuntimeError('Too many media redirects')

    def image(self,url,metadata,site,source):
        self.scanned+=1
        if self.scanned>self.spec['limit']*10:raise LimitReached()
        extension=str(metadata.get('extension','')).lower()
        if extension not in IMAGE_EXTS:self.state['skipped']+=1;return
        if self.state['candidates']>=self.spec['limit']:raise LimitReached()
        self.state['candidates']+=1
        temp=self.raw/('.download-'+str(os.getpid())+'.part')
        try:
            digest=self.fetch_file(url,site,temp)
            from PIL import Image
            with Image.open(temp) as image:
                if image.width*image.height>40_000_000:raise ValueError('Image exceeds 40 million pixels')
                actual=(image.format or '').lower();image.verify()
            actual={'jpeg':'jpg'}.get(actual,actual)
            if actual not in IMAGE_EXTS:raise ValueError('Unsupported image format')
            original=self.raw/(digest+'.'+actual)
            duplicate=original.exists()
            if not duplicate:os.replace(temp,original)
            recipe={'max_edge':2048,'quality':95,'speed':6}
            ready=self.prepared/'images'/(original.name+'.avif')
            animation=self.prepared/'animations'/original.name
            if ready.is_file():
                # Captions may have been edited in the prepared directory.
                # Re-collection must never remove or replace them.
                result={'target':str(ready.relative_to(self.prepared)),'training_image':True}
            elif animation.is_file():
                result={'target':str(animation.relative_to(self.prepared)),'training_image':False}
            else:result=self.converter.convert((str(original),original.name,str(self.prepared),recipe,None))
            row={'source_url':clean_url(source),'media_url':clean_url(url),'site':site,'sha256':digest,
                 'original':str(original.relative_to(self.base)),'prepared':result['target'],
                 'training_image':result['training_image'],'retrieved_utc':datetime.now(timezone.utc).isoformat(),
                 'post_id':str(metadata.get('id',metadata.get('tweet_id','')))[:100],
                 'tags':metadata.get('tags',[]) if isinstance(metadata.get('tags',[]),(str,list)) else [],
                 'caption_status':'not_generated'}
            key=(row['source_url'],digest)
            if key not in self.seen:
                with self.ledger.open('a') as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
                self.seen.add(key)
            self.state['duplicates' if duplicate else 'downloaded']+=1
        except Exception as error:
            self.state['failed']+=1
            name=type(error).__name__;self.state['errors'][name]=self.state['errors'].get(name,0)+1
            if isinstance(error,RuntimeError):raise
        finally:
            temp.unlink(missing_ok=True);self.save()
        time.sleep(1)

    def gallery(self,url,site):
        config=self.gconfig;config.clear()
        for key,value in {'timeout':20,'retries':2,'sleep-request':2,'async':False,'image-range':f'1-{self.spec["limit"]*10}'}.items():
            config.set(('extractor',),key,value)
        category={'x':'twitter','pixiv':'pixiv','gelbooru':'gelbooru'}[site]
        auth=self.auth.get(site,{})
        for local,remote in [('cookies_file','cookies'),('refresh_token','refresh-token'),('api_key','api-key'),('user_id','user-id')]:
            if auth.get(local):config.set(('extractor',category),remote,auth[local])
        outer=self
        class ImagesJob(self.Job.Job):
            def handle_url(self,media,metadata):outer.image(media,metadata,site,url)
            def handle_queue(self,child,metadata):
                if source_site(child)!=site:raise ValueError('Cross-site extraction is disabled')
                nested=ImagesJob(child,self)
                if nested.run():raise RuntimeError('Site extraction failed; check authentication and site availability')
        runner=ImagesJob(url)
        if runner.run():raise RuntimeError('Site extraction failed; check authentication and site availability')

    def run(self):
        logging.disable(logging.CRITICAL)
        try:
            for url,site in zip(self.spec['urls'],self.spec['sites']):
                if site=='pawchive':
                    for post in pawchive_posts(url,self.session(site)):
                        for media,metadata in pawchive_images(post):self.image(media,metadata,site,url)
                else:self.gallery(url,site)
            self.state['state']='completed' if not self.state['failed'] else 'completed_with_errors'
        except LimitReached:self.state['state']='completed' if not self.state['failed'] else 'completed_with_errors'
        except Cancelled:self.state['state']='cancelled'
        except Exception as error:
            self.state['state']='failed';self.state['error_type']=type(error).__name__
            self.state['message']='Collection failed. Check local authentication, source URL, and site/API availability.'
        finally:self.save();self.lock.close()
        return self.state

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',type=Path,default=ROOT)
    p.add_argument('--config',type=Path)
    p.add_argument('--spec',type=Path)
    p.add_argument('--status',type=Path)
    p.add_argument('--doctor',action='store_true')
    p.add_argument('--plan',action='store_true')
    a=p.parse_args();root=a.root.resolve()
    auth=credentials(a.config or root/'secrets/dataset-collector.json')
    if a.doctor:
        try:version=load_runtime(root)[4].__version__
        except ImportError:version=None
        from PIL import features
        print(json.dumps({'gallery_dl':version,'avif_codec':features.check('avif'),'sites':list(SITES),'credentials_configured':{s:any(auth.get(s,{}).values()) for s in SITES},
                          'pawchive_live_api_verified':False,'guide':'manga-studio/docs/dataset-collection.md'}));return
    if not a.spec:p.error('--spec is required')
    spec=validate_spec(json.loads(a.spec.read_text()))
    if a.plan:print(json.dumps({**spec,'network_access':False},ensure_ascii=False));return
    if not a.status:p.error('--status is required for collection')
    signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(Cancelled()))
    signal.signal(signal.SIGINT,lambda *_:(_ for _ in ()).throw(Cancelled()))
    collector=Collector(root,spec,auth,a.status)
    print(json.dumps(collector.run(),ensure_ascii=False))

if __name__=='__main__':main()
