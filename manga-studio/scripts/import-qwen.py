"""Copy the explicitly selected existing Qwen to the Mang-AI model store."""
import hashlib
import json
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[2]
source = Path('/home/hiroshi/.local/share/darask/models/Qwen3.8-27B-TWIN-TURBO-Fable-Cold-Fusion-709-ULTRA-HERETIC-Uncensored.Q8_0.gguf')
folder = root / 'models/llm/qwen'
folder.mkdir(parents=True, exist_ok=True)
target = folder / source.name
def sha(file):
    value = hashlib.sha256()
    with file.open('rb') as stream:
        while block := stream.read(16 * 1024 * 1024):
            value.update(block)
    return value.hexdigest()
expected = sha(source)
if not target.exists():
    temporary = target.with_suffix('.partial')
    shutil.copyfile(source, temporary)
    assert sha(temporary) == expected, 'Qwen checksum mismatch'
    temporary.replace(target)
else:
    assert sha(target) == expected, 'Existing Qwen differs; left unchanged'
(folder / 'source.json').write_text(json.dumps({'source': str(source), 'path': str(target), 'sha256': expected}, ensure_ascii=False, indent=2) + '\n')
print('PASS Qwen imported and verified: ' + str(target), flush=True)
