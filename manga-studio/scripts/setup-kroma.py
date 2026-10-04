"""Install a pinned public Kroma checkpoint without loading it into GPU/RAM."""
import hashlib
import json
from pathlib import Path
import time
import tomllib
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
REPO = "lodestones/Kroma"
REVISION = "b921d45c0f2c33ab753a32e32a5fe34eb790344c"
FILENAME = "kroma-v0.3-turbo.safetensors"
SIZE = 25640191096
SHA256 = "1e58dbbf59bb2cdd8589256666dbc57f73102a06e97293a411e91493e2a675bd"
MODEL_ID = "kroma-v03-turbo"


def checksum(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def install():
    target = ROOT / "krea2-darask/models/diffusion_models/krea2" / FILENAME
    target.parent.mkdir(parents=True, exist_ok=True)
    config_path = ROOT / "krea2-darask/config.local.toml"
    config_text = config_path.read_text()
    config = tomllib.loads(config_text)
    components = ROOT / "krea2-darask/models/krea2-turbo-diffusers"
    if not (components / "model_index.json").is_file():
        raise RuntimeError("Install the official Krea 2 Diffusers components first")
    partial = target.with_suffix(target.suffix + ".partial")
    if not target.exists():
        offset = partial.stat().st_size if partial.exists() else 0
        if offset > SIZE:
            raise RuntimeError(f"Oversized partial file: {partial}")
        if offset < SIZE:
            # Public HF only: never attach the Civitai credential used by other installers.
            request = urllib.request.Request(
                f"https://huggingface.co/{REPO}/resolve/{REVISION}/{FILENAME}",
                headers={"Range": f"bytes={offset}-", "User-Agent": "Mang-AI/Kroma-installer"},
            )
            with urllib.request.urlopen(request, timeout=90) as response:
                if offset and (response.status != 206 or not response.headers.get("Content-Range", "").startswith(f"bytes {offset}-")):
                    raise RuntimeError("Server did not honor the resume offset; partial file was preserved")
                written = offset
                last_report = 0
                with partial.open("ab" if offset else "wb") as stream:
                    while chunk := response.read(8 * 1024 * 1024):
                        if written + len(chunk) > SIZE:
                            raise RuntimeError("Download exceeds the pinned file size")
                        stream.write(chunk)
                        written += len(chunk)
                        if time.monotonic() - last_report > 15:
                            print(f"Kroma: {written / SIZE:.1%} ({written / 1e9:.2f} GB)", flush=True)
                            last_report = time.monotonic()
        candidate = partial
    else:
        candidate = target
    print("Checking pinned SHA-256…", flush=True)
    if candidate.stat().st_size != SIZE or checksum(candidate) != SHA256:
        raise RuntimeError(f"Kroma size/SHA-256 mismatch: {candidate}; configuration was not changed")
    if candidate == partial:
        partial.replace(target)
    if not any(item.get("id") == MODEL_ID for item in config.get("models", [])):
        entry = {
            "id": MODEL_ID, "name": "Kroma v0.3 Turbo · lodestones",
            "kind": "single_file_bf16", "path": str(target), "components": str(components),
            "family": "turbo", "distilled": True, "supported_presets": ["turbo8"],
        }
        # JSON strings/booleans/arrays are valid TOML values for these fields.
        updated = config_text.rstrip() + "\n\n[[models]]\n" + "\n".join(
            f"{key} = {json.dumps(value, ensure_ascii=False)}" for key, value in entry.items()
        ) + "\n"
        tomllib.loads(updated)
        if config_path.read_text() != config_text:
            raise RuntimeError("Configuration changed during download; rerun to register safely")
        staged = config_path.with_suffix(".toml.kroma-new")
        staged.write_text(updated)
        staged.replace(config_path)
    receipt = ROOT / "models/kroma.json"
    receipt.parent.mkdir(parents=True, exist_ok=True)
    receipt.write_text(json.dumps({"repo": REPO, "revision": REVISION, "filename": FILENAME,
                                  "size": SIZE, "sha256": SHA256, "path": str(target),
                                  "model_id": MODEL_ID}, ensure_ascii=False, indent=2) + "\n")
    print(f"Kroma installed and registered: {MODEL_ID}", flush=True)


if __name__ == "__main__":
    install()
