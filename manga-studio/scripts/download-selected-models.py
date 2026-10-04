"""Fetch pinned user-selected SafeTensors, with resumable downloads and SHA256 checks."""
import argparse
import hashlib
import json
import os
import tomllib
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[2]
SELECTION = [
    (3258954, 3142504, "krea", "muse-v35"),
    (3327244, 3213143, "krea", "moody-v8"),
    (3139241, 3019607, "krea", "redcraft-v3"),
    (3374439, 3263048, "h3", "dasiwa-turbo-v3"),
    (3294059, 3185154, "h3", "eros-beta5-int8"),
]

def sha(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(16 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()

def token():
    value = os.environ.get("CIVITAI_API_TOKEN", "")
    path = ROOT / "secrets/models.env"
    if not value and path.exists():
        for line in path.read_text().splitlines():
            if line.startswith("CIVITAI_API_TOKEN="):
                value = line.split("=", 1)[1].strip().strip("\"'")
    return value

def download(record):
    target = ROOT / record["path"]
    expected = record["sha256"]
    if target.exists() and sha(target) == expected:
        print("Verified", record["id"], flush=True)
        return True
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".partial")
    offset = partial.stat().st_size if partial.exists() else 0
    headers = {"Range": f"bytes={offset}-"} if offset else {}
    key = token()
    if key:
        headers["Authorization"] = "Bearer " + key
    with requests.get(record["downloadURL"], headers=headers, stream=True, timeout=(30, 120)) as response:
        if response.status_code in (401, 403):
            print("Authentication/access required:", record["id"], response.status_code, flush=True)
            return
        if response.status_code not in (200, 206):
            raise RuntimeError(f"Download HTTP {response.status_code}: {record['id']}")
        if response.status_code == 206 and not response.headers.get("Content-Range", "").startswith(f"bytes {offset}-"):
            raise RuntimeError("Unexpected resume offset")
        mode = "ab" if response.status_code == 206 and offset else "wb"
        with partial.open(mode) as handle:
            for chunk in response.iter_content(8 * 1024 * 1024):
                handle.write(chunk)
    if sha(partial) != expected:
        raise RuntimeError(f"Checksum mismatch: {record['id']}; partial kept for inspection")
    partial.replace(target)
    print("Downloaded and verified", record["id"], flush=True)
    return True

def register_krea(record):
    if record['family'] != 'krea':
        return
    config = ROOT/'krea2-darask/config.local.toml'
    existing = config.read_text() if config.exists() else ''
    if any(model.get('id') == record['id'] for model in tomllib.loads(existing).get('models', [])):
        return  # Retain user changes to existing registrations.
    quote = lambda value: json.dumps(value, ensure_ascii=False)
    addition = '\n[[models]]\n' + '\n'.join([
        'id = ' + quote(record['id']),
        'name = ' + quote(record['id'] + ' · ' + record['name']),
        'kind = "single_file_int8"',
        'path = ' + quote(str(ROOT/record['path'])),
        'components = ' + quote(str(ROOT/'krea2-darask/models/krea2-turbo-diffusers')),
        'family = "turbo"', 'distilled = true',
    ]) + '\n'
    tomllib.loads(existing + addition)
    config.write_text(existing + addition)
    print('Registered Krea model', record['id'], flush=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*")
    args = parser.parse_args()
    catalog = []
    for version, file_id, family, name in SELECTION:
        response = requests.get(f"https://civitai.com/api/v1/model-versions/{version}", timeout=30)
        response.raise_for_status()
        info = response.json()
        selected = next(file for file in info["files"] if file["id"] == file_id)
        base = "krea2-darask/models/diffusion_models/krea2" if family == "krea" else "models/h3/diffusion_models/MiniMaxH3"
        record = {"id": name, "family": family, "version": version, "fileId": file_id, "name": info["name"], "path": f"{base}/{selected['name']}", "sha256": selected["hashes"]["SHA256"].lower(), "downloadURL": selected["downloadUrl"], "format": selected["metadata"]}
        catalog.append(record)
    destination = ROOT / "models/selected-models.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n")
    for record in catalog:
        if args.only is None or record["id"] in args.only:
            if download(record):
                register_krea(record)
