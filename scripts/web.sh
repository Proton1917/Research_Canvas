#!/usr/bin/env bash
# Research Canvas 前端：依赖安装、开发服务、类型检查与构建。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/environment.sh"
cd "$ROOT"

if [[ ! -x "$ROOT/.runtime/toolchain/node_modules/.bin/node" ]]; then
  printf '缺少项目内 Node %s：%s\n' "$NODE_VERSION" "$ROOT/.runtime/toolchain/node_modules/.bin/node" >&2
  exit 1
fi

yarn_cli() { node "$ROOT/.yarn/releases/yarn-4.7.0.cjs" "$@"; }

case "${1:-dev}" in
  install) yarn_cli install --immutable ;;
  dev) exec node "$ROOT/.yarn/releases/yarn-4.7.0.cjs" dev ;;
  typecheck) yarn_cli typecheck ;;
  build) yarn_cli build ;;
  preview) exec node "$ROOT/.yarn/releases/yarn-4.7.0.cjs" preview ;;
  *) printf '用法：bash scripts/web.sh install|dev|typecheck|build|preview\n' >&2; exit 2 ;;
esac
