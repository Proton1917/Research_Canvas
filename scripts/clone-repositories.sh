#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/.runtime/logs" "$ROOT/tmp"
export TMPDIR="$ROOT/tmp"
export GIT_TERMINAL_PROMPT=0

while IFS=$'\t' read -r category repository; do
  destination="$ROOT/upstream/$category/${repository##*/}"
  url="https://github.com/$repository.git"
  mkdir -p "$(dirname "$destination")"

  if [[ -d "$destination/.git" ]]; then
    origin="$(git -C "$destination" remote get-url origin)"
    if [[ "$origin" != "$url" ]]; then
      printf '仓库来源不一致：%s，当前为 %s\n' "$destination" "$origin" >&2
      exit 1
    fi
    printf '保留已有仓库：%s\n' "$repository"
  else
    printf '克隆仓库：%s\n' "$repository"
    git clone --depth 1 "$url" "$destination"
  fi
done < "$ROOT/config/repositories.tsv"

# Git 提交标识用于记录上游版本。
{
  printf 'repository\tpath\tbranch\tcommit\tcommit_time\tshallow\n'
  while IFS=$'\t' read -r category repository; do
    relative="upstream/$category/${repository##*/}"
    destination="$ROOT/$relative"
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$repository" "$relative" \
      "$(git -C "$destination" branch --show-current)" \
      "$(git -C "$destination" rev-parse HEAD)" \
      "$(git -C "$destination" log -1 --format=%cI)" \
      "$(git -C "$destination" rev-parse --is-shallow-repository)"
  done < "$ROOT/config/repositories.tsv"
} > "$ROOT/docs/repositories-lock.tsv"
