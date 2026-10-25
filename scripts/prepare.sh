#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/environment.sh"

target="${1:?用法：bash scripts/prepare.sh dim0|blocksuite|thoughtdag}"
case "$target" in
  dim0|blocksuite|thoughtdag) ;;
  *) printf '未知项目：%s\n' "$target" >&2; exit 2 ;;
esac

if [[ ! -x "$ROOT/.runtime/toolchain/node_modules/.bin/node" ]]; then
  npm install --prefix "$ROOT/.runtime/toolchain" --no-save --package-lock=false \
    --no-audit --no-fund "node@$NODE_VERSION"
fi
printf '运行环境：Node %s\n' "$(node --version)"

case "$target" in
  dim0)
    cd "$ROOT/upstream/primary/dim0/webui"
    npm ci --no-audit --no-fund
    ;;
  blocksuite)
    cd "$ROOT/upstream/primary/blocksuite"
    node .yarn/releases/yarn-4.7.0.cjs install --immutable
    ;;
  thoughtdag)
    cd "$ROOT/upstream/primary/thoughtdag"
    npm ci --no-audit --no-fund
    ;;
esac
