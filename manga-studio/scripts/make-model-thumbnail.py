"""Create a small reference preview; never modifies the source image/video."""
import argparse
import io
from pathlib import Path
import subprocess
import sys
from PIL import Image, ImageOps

def thumbnail(source):
    path=Path(source)
    Image.MAX_IMAGE_PIXELS=40_000_000
    if path.suffix.lower() in {'.mp4','.webm','.mov','.mkv'}:
        result=subprocess.run(['ffmpeg','-nostdin','-v','error','-threads','1','-protocol_whitelist','file,pipe',
                               '-i',str(path),'-frames:v','1','-vf',"scale=w='min(640,iw)':h='min(640,ih)':force_original_aspect_ratio=decrease",
                               '-f','image2pipe','-vcodec','png','-threads','1','pipe:1'],capture_output=True,timeout=25,check=True)
        image=Image.open(io.BytesIO(result.stdout))
    else:image=Image.open(path)
    with image:
        if image.width*image.height>40_000_000:raise ValueError('Source exceeds 40 million pixels')
        result=ImageOps.exif_transpose(image).convert('RGB')
        result.thumbnail((640,640),Image.Resampling.LANCZOS)
        output=io.BytesIO();result.save(output,format='PNG');return output.getvalue()

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source');args=parser.parse_args()
    sys.stdout.buffer.write(thumbnail(args.source))
