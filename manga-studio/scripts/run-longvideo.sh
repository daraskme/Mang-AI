#!/usr/bin/env bash
set -euo pipefail
STUDIO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_ROOT="$(dirname "$STUDIO_ROOT")"
export HF_HOME="$PROJECT_ROOT/models/huggingface"
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
mkdir -p "$PROJECT_ROOT/work/longvideo" "$PROJECT_ROOT/work/longvideo-input" "$PROJECT_ROOT/work/longvideo-user"
cd "$PROJECT_ROOT/upstream/ComfyUI"
exec nix develop /etc/nixos#cuda -c .venv/bin/python main.py \
  --listen 127.0.0.1 --port 8190 --disable-auto-launch \
  --extra-model-paths-config "$STUDIO_ROOT/longvideo-model-paths.yaml" \
  --output-directory "$PROJECT_ROOT/work/longvideo" \
  --input-directory "$PROJECT_ROOT/work/longvideo-input" \
  --user-directory "$PROJECT_ROOT/work/longvideo-user" \
  --disable-api-nodes
