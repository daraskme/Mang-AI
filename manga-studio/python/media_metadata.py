"""Embed PNG generation data, or create metadata-free posting copies."""
import argparse
import json
from pathlib import Path
import struct
import subprocess
import zlib

PNG=b'\x89PNG\r\n\x1a\n'
def chunks(data):
    if not data.startswith(PNG):raise ValueError('Not a PNG')
    offset=8
    while offset<len(data):
        if offset+12>len(data):raise ValueError('Truncated PNG')
        size=struct.unpack('>I',data[offset:offset+4])[0];end=offset+12+size
        if end>len(data):raise ValueError('Truncated PNG chunk')
        raw=data[offset:end];kind=raw[4:8];yield kind,raw;offset=end
        if kind==b'IEND':return
    raise ValueError('PNG is missing IEND')

def chunk(kind,body):
    return struct.pack('>I',len(body))+kind+body+struct.pack('>I',zlib.crc32(kind+body)&0xffffffff)

def embed_png(path,metadata):
    text=json.dumps(metadata,ensure_ascii=False,separators=(',',':'))
    comment=b'UNICODE\x00'+b'\xfe\xff'+text.encode('utf-16-be')
    # TIFF IFD0 -> Exif IFD -> UserComment (UNDEFINED), with no external pointers.
    exif=b'II'+struct.pack('<HI',42,8)+struct.pack('<H',1)+struct.pack('<HHII',0x8769,4,1,26)+struct.pack('<I',0)
    exif+=struct.pack('<H',1)+struct.pack('<HHII',0x9286,7,len(comment),44)+struct.pack('<I',0)+comment
    extra=chunk(b'eXIf',exif)+chunk(b'iTXt',b'mangai_generation\x00\x00\x00\x00\x00'+text.encode('utf-8'))
    data=PNG;inserted=False
    for kind,raw in chunks(Path(path).read_bytes()):
        if kind in {b'IDAT',b'IEND'} and not inserted:data+=extra;inserted=True
        if kind not in {b'eXIf',b'tEXt',b'zTXt',b'iTXt'}:data+=raw
    Path(path).write_bytes(data)

def strip_metadata(source,destination):
    source=Path(source);destination=Path(destination)
    if source.resolve()==destination.resolve() or destination.exists():raise ValueError('Use a new output path')
    suffix=source.suffix.lower()
    if suffix=='.png':
        # IDAT, orientation-independent pixels and colour-profile chunks remain byte-identical.
        allowed={b'IHDR',b'PLTE',b'IDAT',b'IEND',b'tRNS',b'cHRM',b'gAMA',b'iCCP',b'sRGB',b'sBIT',b'bKGD',b'acTL',b'fcTL',b'fdAT'}
        data=PNG+b''.join(raw for kind,raw in chunks(source.read_bytes()) if kind in allowed)
        with destination.open('xb') as file:file.write(data)
    elif suffix in {'.mp4','.mov','.webm','.mkv'}:
        subprocess.run(['ffmpeg','-nostdin','-n','-v','error','-protocol_whitelist','file,pipe','-i',str(source),
                        '-map','0:v:0','-map','0:a?','-map_metadata','-1','-map_metadata:s','-1','-map_chapters','-1',
                        '-c','copy','-metadata','encoder=',*(['-movflags','+faststart'] if destination.suffix.lower() in {'.mp4','.mov'} else []),str(destination)],
                       check=True,timeout=110,capture_output=True)
    else:
        from PIL import Image,ImageOps
        with Image.open(source) as image:
            if getattr(image,'n_frames',1)>1:raise ValueError('Animated images require a separate export')
            image=ImageOps.exif_transpose(image).convert('RGBA' if 'A' in image.getbands() else 'RGB')
            # Rebuild from pixels to exclude EXIF/XMP/comments inherited in info.
            clean=Image.frombytes(image.mode,image.size,image.tobytes())
            with destination.open('xb') as file:clean.save(file,format='PNG')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source');parser.add_argument('destination');args=parser.parse_args()
    strip_metadata(args.source,args.destination)
