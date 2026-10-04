"""Download the requested creative model; verify the installed caption weights."""
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.environ['HF_HOME'] = str(ROOT / 'models/huggingface')
os.environ['HF_HUB_DISABLE_PROGRESS_BARS'] = '1'
from huggingface_hub import HfApi, hf_hub_download

repo = 'llmfan46/gemma-4-Ortenzya-The-Creative-Wordsmith-31B-it-uncensored-heretic-GGUF'
filename = 'gemma-4-Ortenzya-The-Creative-Wordsmith-31B-it-uncensored-heretic-Q8_0.gguf'
info = HfApi().model_info(repo, files_metadata=True)
entry = next(f for f in info.siblings if f.rfilename == filename)
folder = ROOT / 'models/llm/ortenzya'
print(json.dumps({'phase': 'download', 'repo': repo, 'revision': info.sha, 'file': filename, 'bytes': entry.size}), flush=True)
path = Path(hf_hub_download(repo_id=repo, filename=filename, revision=info.sha, local_dir=folder))
def digest(file):
    sha = hashlib.sha256()
    with file.open('rb') as stream:
        while block := stream.read(16 * 1024 * 1024):
            sha.update(block)
    return sha.hexdigest()
print('Verifying creative and caption weights', flush=True)
sha = digest(path)
assert sha == entry.lfs.sha256, 'Creative model checksum mismatch'
records = [{'role': 'creative', 'repo': repo, 'revision': info.sha, 'path': str(path), 'sha256': sha}]
caption_repo = 'Jommarn/UNSEEN_Gemma_4_26B_NSFW-GGUF'
caption = HfApi().model_info(caption_repo, files_metadata=True)
for filename in ['UNSEEN_Gemma_4_26B_NSFW_Q4_K_M.gguf', 'mmproj-gemma4-vision-f16.gguf']:
    entry = next(f for f in caption.siblings if f.rfilename == filename)
    path = ROOT / 'caption-studio/models/caption' / filename
    if not path.exists():
        path = Path(hf_hub_download(repo_id=caption_repo, filename=filename, revision=caption.sha, local_dir=path.parent))
    sha = digest(path)
    assert sha == entry.lfs.sha256, f'Caption model checksum mismatch: {path}'
    records.append({'role': 'caption', 'repo': caption_repo, 'revision': caption.sha, 'path': str(path), 'sha256': sha})
(ROOT / 'models/language-models.json').write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n')
print('PASS creative and caption model checksums', flush=True)
