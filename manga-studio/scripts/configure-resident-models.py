"""Write local A1/Strata/broker configs. --install installs user units, never starts models.

Requires prepared model files and Strata engine/pack/MTP. Backups preserve the
previous unit and app config. Runtime files, absolute paths and logs stay in work/.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[2]
STUDIO = ROOT / "manga-studio"


def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        backup = path.with_name(path.name + ".before-resident-models")
        if not backup.exists():
            shutil.copy2(path, backup)
    path.write_text(content)


def quoted(value):
    # systemd ExecStart has its own quoting (no shell interpretation).
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'


def env_line(key, value):
    return "Environment=" + quoted(key + "=" + str(value)) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--llama-binary", required=True, type=Path)
    parser.add_argument("--install", action="store_true")
    parser.add_argument("--library-path", default=os.environ.get("LD_LIBRARY_PATH", "/run/opengl-driver/lib"))
    args = parser.parse_args()
    runtime = ROOT / "work/runtime"
    runtime.mkdir(parents=True, exist_ok=True)
    strata = ROOT / "upstream/Strata"
    coder = ROOT / "models/llm/qwen-flash-next"
    agent = ROOT / "models/llm/agents-a1"
    gemma = ROOT / "models/llm/ortenzya/gemma-4-Ortenzya-The-Creative-Wordsmith-31B-it-uncensored-heretic-Q8_0.gguf"
    base = [str(args.llama_binary), "--host", "127.0.0.1", "--n-gpu-layers", "all", "--parallel", "1", "--batch-size", "512", "--ubatch-size", "256", "--cache-type-k", "q8_0", "--cache-type-v", "q8_0", "--flash-attn", "on", "--jinja", "--reasoning-format", "deepseek", "--no-webui"]
    a1_command = base + ["--port", "1240", "--model", str(agent / "Agents-A1-4B-Heretic-ARA-Refusals8-Q8_0.gguf"), "--mmproj", str(agent / "mmproj-Agents-A1-4B-bf16.gguf"), "--image-max-tokens", "1120", "--ctx-size", "65536", "--alias", "agents-a1-4b-q8"]
    strata_config = {
        "exe": str(strata / "engine/strata"), "cwd": str(strata),
        "tokenizer": str(coder / "strata-pack/tokenizer"), "model_name": "qwen3.8-flash-next-q8-strata", "port": 1242,
        "log": str(ROOT / "work/gpu/logs/strata-engine.log"),
        "lib_dirs": [str(strata / ".venv/lib/python3.12/site-packages/nvidia/cu13/lib"), *args.library_path.split(":")],
        "env": {"OMP_NUM_THREADS": "8"}, "draft_vocab": "cjk",
        "args": ["--pack", str(coder / "strata-pack"), "--native", str(coder / "Qwen3.8-Flash-Next-Uncensored-Q8_0-00001-of-00005.gguf"), "--expert-profile", str(strata / "data/expert-profile.bin"), "--expert-cache", "auto", "--prefill", "auto", "--spec", "4", "--spec-min-p", "0.5", "--mtp", str(coder / "mtp/rt"), "--max-context", "262144", "--kv", "int8", "--kv-resident", "32768", "--resident-budget-gib", "64", "--vram-reserve-mib", "8192"],
    }
    write(runtime / "strata-coder.json", json.dumps(strata_config, indent=2) + "\n")
    broker = {"models": {
        "agents-a1-4b-q8": {"resident": True, "port": 1240, "label": "A1 4B Q8"},
        "gemma-4-ortenzya-31b-local": {"phase": "gemma", "port": 1241, "label": "Gemma 4 Ortenzya", "command": base + ["--port", "1241", "--model", str(gemma), "--ctx-size", "32768", "--alias", "gemma-4-ortenzya-31b-local"]},
        "qwen3.8-flash-next-q8-strata": {"phase": "coder", "port": 1242, "label": "Qwen Flash Next Q8 / Strata", "cwd": str(strata), "command": [str(strata / ".venv/bin/python"), "-m", "serve.server", "--engine", "strata", "--config", str(runtime / "strata-coder.json"), "--port", "1242"]},
    }}
    write(runtime / "model-broker.json", json.dumps(broker, indent=2) + "\n")
    common = f"WorkingDirectory={ROOT}\n" + env_line("LD_LIBRARY_PATH", args.library_path) + env_line("MANGAI_GPU_STATE", ROOT / "work/gpu")
    units = {
        "mang-ai-agent.service": "[Unit]\nDescription=Mang-AI resident Agents A1 4B Q8\n\n[Service]\nType=exec\n" + common + "ExecStart=" + " ".join(map(quoted, a1_command)) + "\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=30\n",
        "mang-ai-models.service": "[Unit]\nDescription=Mang-AI model broker and GPU queue\nWants=mang-ai-agent.service\nAfter=mang-ai-agent.service\n\n[Service]\nType=exec\n" + common + "ExecStart=" + " ".join(map(quoted, [sys.executable, STUDIO / "python/model_broker.py", "--config", runtime / "model-broker.json"])) + "\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=30\n",
    }
    for name, content in units.items():
        write(runtime / name, content)
    source = STUDIO / "studio.config.json"
    config = json.loads(source.read_text() if source.exists() else (STUDIO / "studio.config.example.json").read_text())
    config["agent"] = {"baseURL": "http://127.0.0.1:1234/v1", "model": "agents-a1-4b-q8", "contextWindow": 65536, "maxTokens": 8192, "vision": True}
    config["coder"] = {"baseURL": "http://127.0.0.1:1234/v1", "model": "qwen3.8-flash-next-q8-strata", "contextWindow": 262144, "maxTokens": 16384}
    config["gpu"] = {"enabled": True, "baseURL": "http://127.0.0.1:1234"}
    write(runtime / "studio.config.json", json.dumps(config, ensure_ascii=False, indent=2) + "\n")
    if args.install:
        user_units = Path.home() / ".config/systemd/user"
        for name, content in units.items():
            write(user_units / name, content)
        environment = "[Service]\n" + env_line("MANGAI_GPU_STATE", ROOT / "work/gpu") + env_line("PYTHONPATH", STUDIO / "python") + env_line("MANGAI_GPU_RUNNER", STUDIO / "python/mangai_gpu.py") + env_line("MANGAI_GPU_PYTHON", sys.executable)
        for name in ("krea2-studio.service", "h3studio.service", "mang-ai-caption.service", "mang-ai-longvideo.service"):
            write(user_units / (name + ".d") / "mang-ai-gpu.conf", environment)
        write(source, json.dumps(config, ensure_ascii=False, indent=2) + "\n")
        target = ROOT / "upstream/ComfyUI/custom_nodes/mang_ai_gpu"
        target.mkdir(parents=True, exist_ok=True)
        shutil.copy2(STUDIO / "integrations/comfy-gpu-lease/__init__.py", target / "__init__.py")
    print(json.dumps({"runtime": str(runtime), "installed": args.install, "note": "No models started. Run systemctl --user daemon-reload, then launch Mang-AI."}))


if __name__ == "__main__":
    main()
