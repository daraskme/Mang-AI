"""Install the release whose architecture and hash the native H3 adapter validates."""
from pathlib import Path
import hashlib
import os
from huggingface_hub import hf_hub_download

root = Path(__file__).resolve().parents[2]
revision = '3f941d5d182014dd5c0a5e16330420ee2d4aa0c6'
filename = 'minimax_h3_latent_upscaler_3d_conv_v1/minimax_h3_latent_upscaler_3d_conv_v1_bf16.safetensors'
downloaded = Path(hf_hub_download('LBH-123-AI/Minimax_h3_latent_Upscaler', filename, revision=revision, cache_dir=root/'.cache/huggingface/hub'))
with downloaded.open('rb') as handle:
    digest = hashlib.file_digest(handle, 'sha256').hexdigest()
assert digest == '4f57821f5837f32f7142b67d815606dbd7550f194e5c769f7d6c3f83b146a5e6'
target = root/'models/h3/latent_upscalers'/Path(filename).name
target.parent.mkdir(parents=True, exist_ok=True)
if target.is_symlink():
    target.unlink()
if not target.exists():
    os.link(downloaded.resolve(), target)
comfy = root/'upstream/ComfyUI/models/latent_upscale_models'
if not comfy.exists():
    comfy.symlink_to(target.parent, target_is_directory=True)
elif comfy.resolve() != target.parent.resolve() and not (comfy/target.name).exists():
    (comfy/target.name).symlink_to(target)
print('Verified latent upscaler:', target)
