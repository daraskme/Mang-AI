#!/bin/sh
set -eu
STUDIO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$STUDIO_ROOT"
exec "$STUDIO_ROOT/runtime/node" "$STUDIO_ROOT/tools/launch.mjs" "$@"
