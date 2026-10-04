"""Restore pinned runtimes into missing folders; never replace an existing checkout."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess

root = Path(__file__).resolve().parents[2]
source = root/'integrations'
manifest = json.loads((source/'manifest.json').read_text())
# Parent ComfyUI must exist before its custom node folder is restored.
entries = list(manifest['dependencies'].values()) + manifest['patches']
for item in entries:
    target = root/item['path']
    if target.exists():
        print('Existing directory retained:', target)
        continue
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['git', 'clone', item['url'], str(target)], check=True)
    subprocess.run(['git', 'checkout', '--detach', item['revision']], cwd=target, check=True)
    if item.get('patch'):
        patch = source/item['patch']
        assert hashlib.sha256(patch.read_bytes()).hexdigest() == item['sha256']
        subprocess.run(['git', 'apply', '--check', str(patch)], cwd=target, check=True)
        subprocess.run(['git', 'apply', str(patch)], cwd=target, check=True)
caption=root/'caption-studio'
for path in (source/'caption-studio').rglob('*'):
    if path.is_file() and not (caption/path.relative_to(source/'caption-studio')).exists():
        dest=caption/path.relative_to(source/'caption-studio');dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,dest)
print('Source restored. Install dependencies and download models using manga-studio/README.md.')
