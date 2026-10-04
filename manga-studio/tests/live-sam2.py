"""Opt-in SAM2 image/video inference on a synthetic non-sensitive fixture."""
import os
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[2]
os.environ['HF_HOME'] = str(root / 'models/editing/huggingface')
os.environ['TORCH_HOME'] = str(root / 'models/editing/torch')
sys.path.insert(0, str(root / 'upstream/mosaic_editor'))
import cv2
import numpy as np
import torch
from PIL import Image, ImageDraw
from mosaic_editor.detect.sam2_refine import Sam2BoxRefiner
from mosaic_editor.detect.sam2_video import Sam2VideoTracker
from mosaic_editor.detect.base import Detection
from mosaic_editor.core.categories import DEFAULT_CATEGORIES

torch.set_num_threads(4)
image = Image.new('RGB', (128, 128), '#c4c8d0')
ImageDraw.Draw(image).ellipse((32, 32, 96, 96), fill='#cc3322')
refiner = Sam2BoxRefiner()
masks = refiner.segment_boxes(image, [(24, 24, 104, 104)], progress_cb=print)
assert masks[0] is not None and masks[0].shape == (128, 128) and masks[0].any()
print('PASS SAM2 real image segmentation', flush=True)
refiner.unload()
out = root / 'manga-studio/.test-output/sam2'
out.mkdir(parents=True, exist_ok=True)
Image.fromarray(masks[0]).save(out / 'mask.png')
video = out / 'fixture.mp4'
writer = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*'mp4v'), 3, image.size)
for _ in range(3):
    writer.write(cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR))
writer.release()
tracker = Sam2VideoTracker()
masks = tracker.track_video(str(video), [DEFAULT_CATEGORIES[0]], detect_fn=lambda *_: [Detection(label='synthetic circle', category_key=DEFAULT_CATEGORIES[0].key, bbox=(24, 24, 104, 104), score=1.0)], progress_cb=print)
assert set(masks) == {0, 1, 2} and all(mask.any() and mask.shape == (128, 128) for mask in masks.values())
print('PASS SAM2 real video propagation on three frames', flush=True)
