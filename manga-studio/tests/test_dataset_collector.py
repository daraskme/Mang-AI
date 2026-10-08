import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'upstream/dataset-collector-runtime'))
spec=importlib.util.spec_from_file_location('collector',ROOT/'manga-studio/scripts/collect-dataset.py')
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)

class CollectorTests(unittest.TestCase):
    def test_urls_credentials_and_pawchive_payload(self):
        for url in ['https://x.com/a?api_key=secret','http://pixiv.net/a','https://gelbooru.com.evil.test/a']:
            with self.assertRaises(ValueError):c.source_site(url)
        with self.assertRaises(ValueError):c.media_url('https://127.0.0.1/a.jpg','x')
        rows=list(c.pawchive_images({'id':'1','file':{'path':'/aa/bb/test.jpg'},'attachments':[{'path':'/aa/clip.mp4'}]}))
        self.assertEqual(rows[0][0],'https://pawchive.pw/data/aa/bb/test.jpg');self.assertEqual(len(rows),1)
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'auth';p.write_text('{}');p.chmod(0o644)
            with self.assertRaises(ValueError):c.credentials(p)
            p.chmod(0o600);self.assertEqual(c.credentials(p),{})

    def test_real_avif_dedup_and_caption_preservation(self):
        from PIL import Image
        b=io.BytesIO();Image.new('RGB',(60,40),'blue').save(b,format='PNG');data=b.getvalue()
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);collector=c.Collector(root,{'dataset':'case','urls':['https://x.com/user/status/1'],'limit':3},{},root/'status.json')
            collector.fetch_file=lambda _u,_s,p:(p.write_bytes(data),hashlib.sha256(data).hexdigest())[1]
            try:
                with patch.object(c.time,'sleep'):
                    collector.image('https://pbs.twimg.com/image.png',{'extension':'png'},'x','https://x.com/user/status/1')
                    image=next((collector.prepared/'images').glob('*.avif'));caption=image.with_suffix('.txt');caption.write_text('user edited caption')
                    collector.image('https://pbs.twimg.com/image.png',{'extension':'png'},'x','https://x.com/user/status/1')
                self.assertEqual(collector.state['downloaded'],1);self.assertEqual(collector.state['duplicates'],1)
                self.assertEqual(caption.read_text(),'user edited caption')
                self.assertEqual(len(collector.ledger.read_text().splitlines()),1)
                with Image.open(image) as im:self.assertEqual(im.size,(60,40))
            finally:collector.lock.close()

    def test_gallery_dl_extractor_integration_without_network(self):
        from gallery_dl.extractor.common import Extractor
        from gallery_dl.extractor.message import Message
        import re
        class FakeExtractor(Extractor):
            category='twitter';subcategory='tweet';pattern=r'https://x.com/(.*)'
            def items(self):
                yield Message.Directory,'https://x.com/user/status/1',{}
                for n in range(10):yield Message.Url,f'https://pbs.twimg.com/{n}.png',{'extension':'png'}
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);collector=c.Collector(root,{'dataset':'case','urls':['https://x.com/user/status/1'],'limit':2},{},root/'status.json')
            seen=[]
            def sink(*args):
                if len(seen)>=2:raise c.LimitReached()
                seen.append(args[0])
            collector.image=sink
            with patch.object(collector.extractor,'find',lambda url:FakeExtractor(re.match(FakeExtractor.pattern,url))):
                result=collector.run()
            self.assertEqual(result['state'],'completed');self.assertEqual(len(seen),2)

if __name__=='__main__':unittest.main()
