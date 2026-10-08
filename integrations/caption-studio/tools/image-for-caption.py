"""Decode AVIF using Pillow and emit PNG for llama.cpp's vision decoder."""
import sys
from PIL import Image, ImageOps, features

def main():
    if len(sys.argv)!=2:
        raise SystemExit('Usage: image-for-caption.py IMAGE.avif')
    if not features.check('avif'):
        raise SystemExit('AVIF decoding requires a Pillow build with AVIF support')
    with Image.open(sys.argv[1]) as opened:
        if getattr(opened,'n_frames',1)!=1:
            raise SystemExit('Animated AVIF is not supported for still-image captioning')
        if opened.width*opened.height>40_000_000:
            raise SystemExit('Image exceeds 40 million pixels; use a reduced copy')
        image=ImageOps.exif_transpose(opened)
        image=image.convert('RGBA' if 'A' in image.getbands() else 'RGB')
        image.save(sys.stdout.buffer,format='PNG',compress_level=3)

if __name__=='__main__': main()
