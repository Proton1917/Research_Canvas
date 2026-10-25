#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/environment.sh"

if [[ ! -x "$ROOT/.runtime/toolchain/node_modules/.bin/node" ]]; then
  printf '请先执行 bash scripts/prepare.sh <项目名称>。\n' >&2
  exit 1
fi

case "${1:-}" in
  dim0)
    cd "$ROOT/upstream/primary/dim0/webui"
    export VITE_HOST_ORIGIN="http://localhost:$DIM0_PORT"
    export VITE_MINI_APP_ORIGIN="http://localhost:$DIM0_MINI_APP_PORT"
    exec npm run dev -- --host 127.0.0.1 --port "$DIM0_PORT" --strictPort
    ;;
  dim0-mini-app)
    cd "$ROOT/upstream/primary/dim0/webui"
    export VITE_HOST_ORIGIN="http://localhost:$DIM0_PORT"
    export VITE_MINI_APP_ORIGIN="http://localhost:$DIM0_MINI_APP_PORT"
    exec npm run dev:mini-app -- --host 127.0.0.1 --port "$DIM0_MINI_APP_PORT" --strictPort
    ;;
  blocksuite)
    cd "$ROOT/upstream/primary/blocksuite"
    exec node .yarn/releases/yarn-4.7.0.cjs dev --host 127.0.0.1 --port "$BLOCKSUITE_PORT" --strictPort
    ;;
  thoughtdag)
    cd "$ROOT/upstream/primary/thoughtdag"
    export VITE_API_BASE="http://localhost:$THOUGHTDAG_API_PORT"
    exec npm run dev -- --host 127.0.0.1 --port "$THOUGHTDAG_PORT" --strictPort
    ;;
  thoughtdag-api)
    cd "$ROOT/upstream/primary/thoughtdag"
    export HOST=127.0.0.1
    export PORT="$THOUGHTDAG_API_PORT"
    exec npm run server
    ;;
  *)
    printf '用法：bash scripts/dev.sh dim0|dim0-mini-app|blocksuite|thoughtdag|thoughtdag-api\n' >&2
    exit 2
    ;;
esac
