"""Read-only GLM validation preflight. Never downloads or loads a model.

Prints a proposed command and unmet prerequisites; exit 2 means not ready.
GPU inventory and A1 /health do not request inference. Run on the GPU host.
"""
import json
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
ENGINE = ROOT / 'upstream/llama.cpp-glm-validation'
COMMIT = 'd81235049384534c167caea52b85a694f6103d14'
REVISION = 'a38483c8cd5df544f53d70fb281afe97369d5ab6'
FOLDER = ROOT / 'models/llm/glm-5.3-flash-validation'
SIZES = [9429984, 49989334176, 49607025280, 49486530144, 7729791616]
SHAS = [
    'c2f3b6ab98d3df844f322ea376059202d2eaeedcee1f0eff455345b86a137dbd',
    '7d64cf0395672c4322012841abec502ea7e20518299bb5e3069003f06f9e6de9',
    '7c2c63c9c30f8060428fdf2ac935dbf2ee9ad8f771d62b6ae47a7f7f2c1520e7',
    '06c90f191871317c92dd9d25a353b687aed44c50f3ac6c713e9fe410bc2d26dd',
    '66ebf9ec85e04d3f44af674ae4f694acbc89cc53db75e42f2f4d3646bf321c0d',
]
FILES = [f'UD-IQ4_XS/GLM-5.3-Flash-UD-IQ4_XS-{i:05d}-of-00005.gguf' for i in range(1, 6)]


def command():
    # Header inventory: 73.723 GiB CPU experts, 68.935 GiB other weights.
    # Runtime caches and scratch memory are additional; this is not a fit guarantee.
    return [
        str(ENGINE / 'build/bin/llama-server'),
        '--model', str(FOLDER / FILES[0]),
        '--host', '127.0.0.1', '--port', '1243',
        '--alias', 'glm-5.3-flash-iq4-validation',
        '--parallel', '1', '--ctx-size', '8192',
        '--batch-size', '256', '--ubatch-size', '128',
        '--threads', '8', '--threads-batch', '8',
        '--flash-attn', 'on', '--cache-type-k', 'f16', '--cache-type-v', 'f16',
        '--n-gpu-layers', 'all', '--n-cpu-moe', '26', '--fit', 'off',
        '--jinja', '--chat-template-kwargs', '{"reasoning_effort":"low"}',
        '--temp', '1.0', '--top-p', '0.95', '--no-webui',
    ]


def preflight():
    blockers = []
    report = {
        'mode': 'read_only_preflight', 'inferenceRun': False,
        'engineCommit': COMMIT, 'modelRevision': REVISION,
        'weightBytes': sum(SIZES), 'commandPreview': command(),
        'minimumFreeRamGiB': 88, 'minimumFreeVramGiB': 80,
        'memoryLimitsAreProvisional': True,
        'cacheNote': 'F16 baseline; KDA recurrent state remains F32. No MTP.',
    }
    try:
        actual = subprocess.check_output(['git', '-C', str(ENGINE), 'rev-parse', 'HEAD'], text=True, stderr=subprocess.DEVNULL, timeout=5).strip()
        report['engineActualCommit'] = actual
        if actual != COMMIT:
            blockers.append('engine_revision_mismatch')
    except (OSError, subprocess.SubprocessError):
        blockers.append('engine_source_missing')
    if not (ENGINE / 'build/bin/llama-server').is_file():
        blockers.append('engine_build_missing')
    manifest = {}
    try:
        manifest = json.loads((FOLDER / 'verified-model.json').read_text())
    except (OSError, ValueError):
        pass
    if not isinstance(manifest, dict):
        manifest = {}
    entries = manifest.get('verified', [])
    records = {item.get('file'): item for item in entries if isinstance(item, dict)} if isinstance(entries, list) else {}
    report['files'] = []
    for name, size, sha in zip(FILES, SIZES, SHAS):
        path = FOLDER / name
        actual_size = path.stat().st_size if path.is_file() else None
        record = records.get(name, {})
        verified = (manifest.get('revision') == REVISION and record.get('sha256') == sha and record.get('bytes') == size)
        report['files'].append({'file': name, 'expectedBytes': size, 'actualBytes': actual_size, 'downloadHashRecorded': verified})
        if actual_size != size or not verified:
            blockers.append(f'model_missing_or_unverified:{name}')
    report['hashNote'] = 'Checks saved download verification and current sizes; does not rehash model files.'
    report['diskFreeGiB'] = round(shutil.disk_usage(ROOT).free / 1024**3, 2)
    try:
        fields = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
        ram = int(fields['MemAvailable'].split()[0]) / 1024**2
        report['ramAvailableGiB'] = round(ram, 2)
        if ram < report['minimumFreeRamGiB']:
            blockers.append('insufficient_ram_user_must_stop_vms')
    except (OSError, KeyError, ValueError):
        blockers.append('ram_measurement_unavailable')
    try:
        data = subprocess.check_output(['nvidia-smi', '--query-gpu=memory.free', '--format=csv,noheader,nounits'], text=True, stderr=subprocess.DEVNULL, timeout=5)
        vram = float(data.splitlines()[0]) / 1024
        report['vramFreeGiB'] = round(vram, 2)
        if vram < report['minimumFreeVramGiB']:
            blockers.append('insufficient_vram')
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        blockers.append('gpu_measurement_unavailable_run_on_host')
    try:
        with urllib.request.urlopen('http://127.0.0.1:1240/health', timeout=2) as response:
            report['a1Healthy'] = response.status == 200
    except OSError:
        report['a1Healthy'] = False
    if not report['a1Healthy']:
        blockers.append('resident_a1_not_ready')
    with socket.socket() as sock:
        sock.settimeout(1)
        try:
            if sock.connect_ex(('127.0.0.1', 1243)) == 0:
                blockers.append('validation_port_1243_in_use')
        except OSError:
            blockers.append('validation_port_check_failed')
    report['blockers'] = blockers
    report['readyForManualValidation'] = not blockers
    return report


if __name__ == '__main__':
    result = preflight()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result['readyForManualValidation'] else 2)
