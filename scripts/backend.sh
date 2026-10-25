#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/environment.sh"
cd "$ROOT"
export CARGO_HOME="$ROOT/.runtime/cargo-home"
export CARGO_TARGET_DIR="$ROOT/.runtime/target"

case "${1:-run}" in
  build)
    cargo build -p research-canvas-server
    mkdir -p "$ROOT/.runtime/bin"
    cp "$CARGO_TARGET_DIR/debug/research-canvas-server" "$ROOT/.runtime/bin/research-canvas-server.new"
    mv "$ROOT/.runtime/bin/research-canvas-server.new" "$ROOT/.runtime/bin/research-canvas-server"
    ;;
  run) exec cargo run -p research-canvas-server ;;
  start) exec "$ROOT/.runtime/bin/research-canvas-server" ;;
  *) printf '用法：bash scripts/backend.sh build|run|start\n' >&2; exit 2 ;;
esac
