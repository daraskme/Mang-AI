"""Fetch the requested agent/coder weights at pinned revisions; no GPU use.

Run with a Python environment containing huggingface_hub. Downloads resume;
every completed file is checked against the publisher's SHA256 before use.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault('HF_HOME', str(ROOT / 'models/huggingface'))
os.environ.setdefault('HF_HUB_DISABLE_PROGRESS_BARS', '1')
os.environ.setdefault('HF_XET_NUM_CONCURRENT_RANGE_GETS', '4')
os.environ.setdefault('HF_HUB_DOWNLOAD_TIMEOUT', '120')
from huggingface_hub import HfApi, hf_hub_download


def hub_token():
    if os.getenv('HF_TOKEN'):
        return os.environ['HF_TOKEN']
    secret = ROOT / 'secrets/models.env'
    if secret.exists():
        for line in secret.read_text().splitlines():
            key, sep, value = line.partition('=')
            if sep and key.strip() == 'HF_TOKEN':
                return value.strip().strip('"').strip("'") or None
    # HF_HOME is scoped to the SSD cache, but an existing user login is still usable.
    for path in [ROOT / 'models/huggingface/token', Path.home() / '.cache/huggingface/token']:
        if path.is_file():
            return path.read_text().strip() or None
    return None

SOURCES = {
    'agent': {
        'repo': 'NullpoLab/Agents-A1-4B-Heretic-ARA-Refusals8-GGUF',
        'revision': '53e7b782a1e8b1890593390185c5a79387448954',
        'folder': 'agents-a1',
        'files': ['Agents-A1-4B-Heretic-ARA-Refusals8-Q8_0.gguf', 'mmproj-Agents-A1-4B-bf16.gguf'],
    },
    'coder': {
        'repo': 'orcarouter/Qwen3.8-Flash-Next-Uncensored-GGUF',
        'revision': 'e43d00f4e2b8b40b89f75e9adeb1045ac34c8acc',
        'folder': 'qwen-flash-next',
        'files': [f'Qwen3.8-Flash-Next-Uncensored-Q8_0-{i:05d}-of-00005.gguf' for i in range(1, 6)],
    },
}

# Validation candidates are opt-in; `all` continues to install only agent/coder.
VALIDATION_SOURCES = {
    'glm-validation': {
        'repo': 'unsloth/GLM-5.3-Flash-GGUF',
        'revision': 'a38483c8cd5df544f53d70fb281afe97369d5ab6',
        'folder': 'glm-5.3-flash-validation',
        'files': [f'UD-IQ4_XS/GLM-5.3-Flash-UD-IQ4_XS-{i:05d}-of-00005.gguf' for i in range(1, 6)],
    },
}


def download(role):
    spec = {**SOURCES, **VALIDATION_SOURCES}[role]
    folder = ROOT / 'models/llm' / spec['folder']
    folder.mkdir(parents=True, exist_ok=True)
    token = hub_token()
    info = HfApi(token=token).model_info(spec['repo'], revision=spec['revision'], files_metadata=True)
    records = []
    for filename in spec['files']:
        entry = next(f for f in info.siblings if f.rfilename == filename)
        print(json.dumps({'phase': 'download', 'role': role, 'file': filename, 'bytes': entry.size}), flush=True)
        path = Path(hf_hub_download(repo_id=spec['repo'], filename=filename, revision=spec['revision'], local_dir=folder, token=token))
        print(json.dumps({'phase': 'verify', 'file': filename}), flush=True)
        sha = hashlib.sha256()
        with path.open('rb') as stream:
            while block := stream.read(8 * 1024 * 1024):
                sha.update(block)
        if path.stat().st_size != entry.size or sha.hexdigest() != entry.lfs.sha256:
            raise RuntimeError(f'File verification failed: {filename}')
        records.append({'file': filename, 'bytes': entry.size, 'sha256': sha.hexdigest()})
        manifest = folder / 'verified-model.json'
        staging = manifest.with_suffix('.partial')
        staging.write_text(json.dumps({**spec, 'verified': records}, ensure_ascii=False, indent=2) + '\n')
        staging.replace(manifest)
        print(json.dumps({'phase': 'verified', 'file': filename}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('role', choices=[*SOURCES, *VALIDATION_SOURCES, 'all'])
    args = parser.parse_args()
    for role in SOURCES if args.role == 'all' else [args.role]:
        download(role)
