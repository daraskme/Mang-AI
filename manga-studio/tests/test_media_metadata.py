import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from PIL import Image,ExifTags

path=Path(__file__).resolve().parents[1]/'python/media_metadata.py'
spec=importlib.util.spec_from_file_location('metadata',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class MetadataTests(unittest.TestCase):
    def test_png_roundtrip_exif_pixels_and_clean_copy(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);source=root/'original.png';dest=root/'posting.png'
            Image.new('RGB',(32,32),'blue').save(source)
            payload={'prompt':'青い花瓶','seed':42,'loras':[{'id':'sample','weight':.8}]}
            m.embed_png(source,payload);before=source.read_bytes()
            with Image.open(source) as image:
                self.assertEqual(json.loads(image.info['mangai_generation']),payload)
                comment=image.getexif().get_ifd(ExifTags.IFD.Exif)[0x9286]
                self.assertEqual(json.loads(comment[8:].decode('utf-16')),payload);pixels=image.tobytes()
            m.strip_metadata(source,dest)
            self.assertEqual(source.read_bytes(),before)
            with Image.open(dest) as image:self.assertEqual(image.tobytes(),pixels);self.assertFalse(image.getexif());self.assertNotIn('mangai_generation',image.info)
            self.assertEqual([r for k,r in m.chunks(before) if k==b'IDAT'],[r for k,r in m.chunks(dest.read_bytes()) if k==b'IDAT'])
            with self.assertRaises(ValueError):m.strip_metadata(source,source)

    def test_mp4_clean_copy_removes_private_tags_without_reencoding(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);source=root/'original.mp4';dest=root/'posting.mp4'
            subprocess.run(['ffmpeg','-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=64x64:r=5','-t','1',
                            '-c:v','libx264','-threads','1','-metadata','comment=private prompt','-metadata','title=private title',str(source)],check=True,capture_output=True)
            before=source.read_bytes();m.strip_metadata(source,dest)
            probe=lambda p:json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-show_packets','-show_data_hash','sha256','-of','json',str(p)]))
            original=probe(source);clean=probe(dest)
            self.assertNotIn('private',json.dumps(clean));self.assertEqual(source.read_bytes(),before)
            self.assertEqual([p['data_hash'] for p in original['packets']],[p['data_hash'] for p in clean['packets']])

if __name__=='__main__':unittest.main()
