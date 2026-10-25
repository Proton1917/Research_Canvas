#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
if [[ ! -f config/server.toml ]]; then
  cp config/server.example.toml config/server.toml
fi
printf 'Research Canvas\n打开 http://127.0.0.1:8787\n停止服务：Ctrl+C\n'
exec ./research-canvas
