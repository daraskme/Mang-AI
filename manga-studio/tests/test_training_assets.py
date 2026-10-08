import importlib.util
import json
import hashlib
from pathlib import Path
import tempfile
import unittest

SCRIPTS=Path(__file__).resolve().parents[1]/'scripts'
def module(name):
    spec=importlib.util.spec_from_file_location(name,SCRIPTS/(name+'.py'))
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod

class RestoreTests(unittest.TestCase):
    def test_checksum_mismatch_and_existing_edits_are_protected(self):
        restore=module('restore-training-assets')
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);src=root/'source';dst=root/'target'
            src.write_bytes(b'checkpoint')
            record={'bytes':10,'sha256':hashlib.sha256(b'checkpoint').hexdigest()}
            self.assertEqual(restore.install(src,dst,record),'restored')
            self.assertEqual(restore.install(src,dst,record),'already-present')
            dst.write_bytes(b'local edit')
            with self.assertRaises(FileExistsError):restore.install(src,dst,record)
            self.assertEqual(dst.read_bytes(),b'local edit')
            with self.assertRaises(ValueError):restore.install(src,root/'bad',{**record,'sha256':'0'*64})
            self.assertFalse((root/'bad').exists())
            long_name=root/('あ'*80+'.bin')
            self.assertEqual(restore.install(src,long_name,record),'restored')

    def test_traversal_and_symlink_escape_are_rejected(self):
        restore=module('restore-training-assets')
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)/'dest';root.mkdir()
            (root/'link').symlink_to(Path(t),target_is_directory=True)
            for name in ('../escape','/absolute','link/escape','.git/config','secrets/token','a\\b'):
                with self.subTest(name=name),self.assertRaises(ValueError):restore.safe_path(root,name)

class ConversionTests(unittest.TestCase):
    def test_resize_caption_collisions_alpha_and_resume(self):
        try:
            from PIL import Image,features
        except ImportError:self.skipTest('Pillow is required for codec tests')
        if not features.check('avif'):self.skipTest('AVIF encoder is required')
        converter=module('optimize-training-images')
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);source=root/'source';out=root/'out';source.mkdir();out.mkdir()
            Image.new('RGB',(80,40),'blue').save(source/'same.jpg')
            Image.new('RGBA',(2050,20),(40,90,180,255)).save(source/'same.png')
            Image.new('RGBA',(32,24),(40,90,180,100)).save(source/'transparent.png')
            (source/'same.txt').write_text('caption v1')
            recipe={'max_edge':2048,'quality':95,'speed':8}
            first=converter.convert((str(source/'same.jpg'),'same.jpg',str(out),recipe,None))
            large=converter.convert((str(source/'same.png'),'same.png',str(out),recipe,None))
            alpha=converter.convert((str(source/'transparent.png'),'transparent.png',str(out),recipe,None))
            self.assertEqual(first['size'],[80,40]);self.assertEqual(max(large['size']),2048)
            self.assertNotEqual(first['caption']['target'],large['caption']['target'])
            with Image.open(out/alpha['target']) as decoded:self.assertIn('A',decoded.getbands())
            with Image.open(source/'same.png') as original:self.assertEqual(original.size,(2050,20))
            (source/'same.txt').write_text('caption v2')
            resumed=converter.convert((str(source/'same.jpg'),'same.jpg',str(out),recipe,first))
            self.assertTrue(resumed['reused'])
            self.assertEqual((out/resumed['caption']['target']).read_text(),'caption v2')

if __name__=='__main__':unittest.main()
