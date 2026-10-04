"""Download the user-requested local runtime directly; never redistribute it."""
import json
import os
from pathlib import Path
from huggingface_hub import HfApi, snapshot_download

ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault("HF_HOME", str(ROOT / "models/huggingface"))
repo = "Smite79/MiniMax-H3-Longvideos"
revision = '932b4e751c70a2d0194c2b7c7f731106adb830af'
destination = ROOT / "upstream/ComfyUI/custom_nodes/H3-LongVideos"
snapshot_download(repo, revision=revision, local_dir=destination, ignore_patterns=["test_*.py", ".git*"])
(ROOT / "models/longvideo-runtime.json").write_text(json.dumps({"repo": repo, "revision": revision, "path": str(destination), "redistribute": False}, indent=2) + "\n")
print("Installed original H3-LongVideos", revision)
