#!/usr/bin/env bash

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/config/runtime.env"
mkdir -p "$ROOT/.runtime/logs" "$ROOT/tmp"
export TMPDIR="$ROOT/tmp"
export npm_config_cache="$ROOT/.runtime/npm-cache"
export XDG_CACHE_HOME="$ROOT/.runtime/cache"
export COREPACK_HOME="$ROOT/.runtime/corepack"
export YARN_ENABLE_GLOBAL_CACHE=false
export YARN_CACHE_FOLDER="$ROOT/.runtime/yarn-cache"
export YARN_GLOBAL_FOLDER="$ROOT/.runtime/yarn-global"
export HUSKY=0
export PATH="$ROOT/.runtime/toolchain/node_modules/.bin:$PATH"
