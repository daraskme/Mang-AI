"""IOPaint + daraskme/mosaic_editor bridge. JSON in, JSON progress out."""
import base64
import io
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps


def emit(**value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def load_image(path, seconds=0):
    if path.suffix.lower() == '.mp4':
        cap = cv2.VideoCapture(str(path))
        try:
            cap.set(cv2.CAP_PROP_POS_MSEC, float(seconds) * 1000)
            ok, frame = cap.read()
            if not ok:
                raise ValueError('動画フレームを読み込めません')
            return Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        finally:
            cap.release()
    return ImageOps.exif_transpose(Image.open(path)).convert('RGB')


def info(path):
    if path.suffix.lower() != '.mp4':
        with Image.open(path) as image:
            image = ImageOps.exif_transpose(image)
            return dict(kind='image', width=image.width, height=image.height)
    cap = cv2.VideoCapture(str(path))
    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if not cap.isOpened() or fps <= 0 or frames <= 0:
            raise ValueError('MP4を読み込めません')
        return dict(kind='video', width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)), fps=fps, frames=frames, duration=frames / fps)
    finally:
        cap.release()


def categories(request):
    from mosaic_editor.core.categories import DEFAULT_CATEGORIES
    names = request.get('categories', ['penis', 'vagina'])
    if not names or any(name not in {c.key for c in DEFAULT_CATEGORIES} for name in names):
        raise ValueError('自動検出カテゴリを選んでください')
    return [c for c in DEFAULT_CATEGORIES if c.key in names]


def detect(image, request):
    from mosaic_editor.detect.pipeline import DetectionPipeline
    pipeline = DetectionPipeline()
    found = pipeline.detect(image, categories(request), threshold=float(request.get('threshold', .3)), use_refiner=bool(request.get('refine', False)), progress_cb=lambda message: emit(progress=message))
    mask = pipeline.combine_masks(found, image.size, margin_px=int(request.get('margin', 4)))
    return mask, [dict(label=d.label, category=d.category_key, bbox=d.bbox, score=d.score, refined=d.mask is not None) for d in found]


def mask_for(image, request):
    mask = Image.new('L', image.size)
    if request.get('mask'):
        encoded = request['mask'].split(',', 1)[-1]
        supplied = Image.open(io.BytesIO(base64.b64decode(encoded, validate=True)))
        if supplied.size != image.size:
            raise ValueError('マスクと画像の大きさが一致しません')
        mask = supplied.convert('L')
    draw = ImageDraw.Draw(mask)
    for region in request.get('regions', []):
        x, y, w, h = [float(region[key]) for key in ('x', 'y', 'width', 'height')]
        if not all(math.isfinite(v) for v in (x, y, w, h)) or min(x, y) < 0 or min(w, h) <= 0 or x+w > image.width or y+h > image.height:
            raise ValueError('選択範囲は画像ピクセル内で指定してください')
        draw.rectangle((x, y, x+w-1, y+h-1), fill=255)
    result = np.where(np.asarray(mask) > 127, 255, 0).astype(np.uint8)
    detections = []
    if request.get('autoDetect'):
        detected, detections = detect(image, request)
        result = np.maximum(result, detected)
    return result, detections


def save_png(array, path):
    temporary = path.with_suffix('.partial.png')
    Image.fromarray(np.clip(array, 0, 255).astype(np.uint8)).save(temporary, format='PNG')
    temporary.replace(path)


def mosaic_video(source, output, request):
    from mosaic_editor.core.masking import apply_mosaic, auto_block_size
    from mosaic_editor.detect.pipeline import DetectionPipeline
    metadata = info(source)
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        raise ValueError('音声を保持して動画を書き出すには ffmpeg が必要です')
    start = float(request.get('startSeconds', 0))
    end = float(request.get('endSeconds', metadata['duration']))
    if not 0 <= start < end <= metadata['duration'] + .1:
        raise ValueError('動画の処理時間が不正です')
    tracked = {}
    if request.get('autoDetect'):
        if metadata['width'] * metadata['height'] * metadata['frames'] > 300_000_000:
            raise ValueError('自動追跡は300M画素フレーム以内です。動画を短く分割してください')
        tracked = DetectionPipeline().track_video(str(source), categories(request), threshold=float(request.get('threshold', .3)), progress_cb=lambda message: emit(progress=message))
    image = load_image(source)
    manual, _ = mask_for(image, {**request, 'autoDetect': False})
    if not tracked and not manual.any():
        raise ValueError('モザイク対象がありません。範囲を指定してください')
    block = int(request.get('block') or auto_block_size(image.width, image.height))
    cap = cv2.VideoCapture(str(source))
    silent = output.with_suffix('.silent.mp4')
    writer = cv2.VideoWriter(str(silent), cv2.VideoWriter_fourcc(*'mp4v'), metadata['fps'], image.size)
    if not writer.isOpened():
        cap.release()
        raise ValueError('動画エンコーダーを開けません')
    count = 0
    try:
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            if start <= count / metadata['fps'] < end:
                mask = np.maximum(manual, tracked.get(count, np.zeros_like(manual)))
                if mask.any():
                    bgr = cv2.cvtColor(apply_mosaic(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), mask, block), cv2.COLOR_RGB2BGR)
            writer.write(bgr)
            count += 1
            if count % 24 == 0:
                emit(progress=f'動画処理 {count}/{metadata["frames"]}')
    finally:
        cap.release()
        writer.release()
    if count != metadata['frames']:
        raise ValueError('すべての動画フレームを読み取れませんでした')
    temporary = output.with_suffix('.partial.mp4')
    subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', str(silent), '-i', str(source), '-map', '0:v:0', '-map', '1:a?', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-shortest', str(temporary)], check=True)
    temporary.replace(output)
    silent.unlink()
    return {'frames': count, 'trackedFrames': len(tracked)}


def main(request):
    sys.path.insert(0, request['mosaicRepo'])
    source = Path(request['source'])
    mode = request['mode']
    if mode == 'info':
        return info(source)
    image = load_image(source, request.get('time', 0))
    if image.width * image.height > 32_000_000:
        raise ValueError('編集画像は32メガピクセル以内にしてください')
    if mode == 'detect':
        mask, found = detect(image, request)
        buffer = io.BytesIO()
        Image.fromarray(mask).save(buffer, format='PNG')
        return {'mask': 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode(), 'detections': found}
    output = Path(request['output'])
    if output.exists():
        raise ValueError('既存の結果には上書きしません')
    if source.suffix.lower() == '.mp4':
        if mode != 'mosaic':
            raise ValueError('動画はモザイク処理に対応しています。IOPaint修正は静止画で行ってください')
        return mosaic_video(source, output, request)
    mask, found = mask_for(image, request)
    if not mask.any():
        raise ValueError('処理範囲がありません。ブラシ・矩形か自動検出で指定してください')
    rgb = np.asarray(image)
    if mode == 'mosaic':
        from mosaic_editor.core.masking import apply_mosaic, auto_block_size
        result = apply_mosaic(rgb, mask, int(request.get('block') or auto_block_size(image.width, image.height)))
    elif mode == 'inpaint':
        import torch
        from iopaint.model.lama import LaMa
        from iopaint.schema import InpaintRequest
        torch.set_num_threads(4)
        emit(progress='IOPaint / LaMa で選択範囲を補完しています')
        model = LaMa(device=torch.device('cpu'))
        with torch.inference_mode():
            # IOPaint's unmasked-area blend can return float64 (0..255).
            # IOPaint's HD crop path writes into its input array. PIL-backed
            # np.asarray is read-only; keep it intact for the exact outside-mask
            # restoration below, and pass a writable copy to the model.
            bgr = np.clip(model(rgb.copy(), mask, InpaintRequest()), 0, 255).astype(np.uint8)
            result = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        # Keep every unselected pixel exactly, regardless of model crop options.
        result[mask == 0] = rgb[mask == 0]
    else:
        raise ValueError('編集モードが不正です')
    save_png(result, output)
    return {'width': image.width, 'height': image.height, 'detections': found}


if __name__ == '__main__':
    try:
        emit(result=main(json.load(sys.stdin)))
    except Exception as error:
        emit(error=str(error))
        raise
