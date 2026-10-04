"""Track local runtime edits as patches, retaining existing nested Git histories."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'integrations'
OUT.mkdir(exist_ok=True)
REPOS = {
    'krea2': 'krea2-darask',
    'h3': 'minimaxH3-darask',
    'latent-upscaler': 'upstream/ComfyUI/custom_nodes/Comfyui_Minimax_h3_latent_Upscaler',
}
manifest = []
for name, location in REPOS.items():
    cwd = ROOT/location
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=cwd)
    patch = git('diff', '--binary', 'HEAD')
    for relative in git('ls-files', '--others', '--exclude-standard', '-z').decode().split('\0'):
        if not relative:
            continue
        if '__pycache__' in Path(relative).parts or Path(relative).suffix == '.pyc':
            continue
        path = cwd/relative
        if path.suffix not in {'.py', '.json', '.md', '.toml', '.txt', '.sh', '.yaml', '.yml'} or path.stat().st_size > 2_000_000:
            raise RuntimeError(f'Review untracked file before publishing: {location}/{relative}')
        result = subprocess.run(['git', 'diff', '--no-index', '--binary', '--', '/dev/null', relative], cwd=cwd, capture_output=True)
        if result.returncode not in (0, 1):
            raise RuntimeError(result.stderr.decode())
        patch += result.stdout
    (OUT/f'{name}.patch').write_bytes(patch)
    manifest.append({'name': name, 'path': location, 'url': git('remote', 'get-url', 'origin').decode().strip(), 'revision': git('rev-parse', 'HEAD').decode().strip(), 'patch': f'{name}.patch', 'sha256': hashlib.sha256(patch).hexdigest()})

# The caption workspace was supplied as a folder, not a Git checkout.
caption = ROOT/'caption-studio'
for relative in ['lib', 'public', 'tools', 'tests', 'README.md', 'package.json', 'server.mjs', 'start.sh']:
    source, destination = caption/relative, OUT/'caption-studio'/relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.is_dir():
        shutil.copytree(source, destination, dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    else:
        shutil.copy2(source, destination)

dependencies = {}
for relative in ['src','pyproject.toml','uv.lock','README.md','README.ja.md']:
    source=caption/'vendor/musubi-tuner'/relative;dest=OUT/'caption-studio/vendor/musubi-tuner'/relative
    if not source.exists():
        continue
    dest.parent.mkdir(parents=True,exist_ok=True)
    if source.is_dir():
        shutil.copytree(source,dest,dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    else:
        shutil.copy2(source,dest)
for name, relative in {'comfyui':'upstream/ComfyUI','iopaint':'upstream/IOpaint','mosaic-editor':'upstream/mosaic_editor','krea-official':'upstream/krea-2'}.items():
    cwd = ROOT/relative
    dependencies[name] = {'path': relative, 'revision': subprocess.check_output(['git','rev-parse','HEAD'],cwd=cwd).decode().strip(), 'url':subprocess.check_output(['git','remote','get-url','origin'],cwd=cwd).decode().strip()}
(OUT/'manifest.json').write_text(json.dumps({'patches':manifest,'dependencies':dependencies,'longvideos':{'repo':'Smite79/MiniMax-H3-Longvideos','revision':'932b4e751c70a2d0194c2b7c7f731106adb830af','redistribute':False}}, indent=2)+'\n')
print('Exported runtime source changes; models, secrets and LongVideos code excluded.')
