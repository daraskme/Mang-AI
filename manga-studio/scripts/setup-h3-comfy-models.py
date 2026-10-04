"""Install the matching local text/audio/video codecs for native H3 LongVideos."""
import os
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault("HF_HOME", str(ROOT / "models/huggingface"))
from huggingface_hub import HfApi, hf_hub_download

repo = "Comfy-Org/MiniMax-H3"
revision = HfApi().model_info(repo).sha
for filename in ["text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "vae/minimax_h3_video_vae_fp16.safetensors", "vae/minimax_h3_audio_vae_fp32.safetensors"]:
    print(hf_hub_download(repo, filename=filename, revision=revision, local_dir=ROOT / "models/h3/comfy"), flush=True)
(ROOT / "models/h3/comfy/source.txt").write_text(f"{repo}@{revision}\n")
