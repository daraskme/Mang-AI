#!/usr/bin/env bash
set -euo pipefail
# CPU-only wheels still need the host C/C++ and image libraries on NixOS.
# No CUDA shell or generation runtime is required for image editing.
if command -v nix >/dev/null 2>&1 && [[ -d /etc/nixos ]]; then
  edit_host="$(hostname)"
  edit_libs="$(nix eval --raw "/etc/nixos#nixosConfigurations.${edit_host}.pkgs" --apply 'p: p.lib.makeLibraryPath [ p.stdenv.cc.cc.lib p.zlib p.glib p.libGL ]')"
  export LD_LIBRARY_PATH="${edit_libs}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
fi
exec "$@"
