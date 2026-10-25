#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/environment.sh"
cd "$ROOT"
export CARGO_HOME="$ROOT/.runtime/cargo-home"
export CARGO_TARGET_DIR="$ROOT/target"

case "${1:-run}" in
  build)
    cargo build
    mkdir -p "$ROOT/.runtime/bin"
    cp "$CARGO_TARGET_DIR/debug/research-canvas" "$ROOT/.runtime/bin/research-canvas.new"
    mv "$ROOT/.runtime/bin/research-canvas.new" "$ROOT/.runtime/bin/research-canvas"
    ;;
  run) exec cargo run ;;
  start) exec "$ROOT/.runtime/bin/research-canvas" ;;
  *) printf '用法：bash scripts/backend.sh build|run|start\n' >&2; exit 2 ;;
esac
