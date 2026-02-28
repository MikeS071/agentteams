#!/bin/bash
set -euo pipefail

REAL_OPENFANG="/root/.openfang/bin/openfang-real"
if [ ! -x "$REAL_OPENFANG" ]; then
  REAL_OPENFANG="/root/.openfang/bin/openfang"
fi

if [ "${1:-}" = "init" ] && [ "${2:-}" = "--non-interactive" ]; then
  shift 2
  exec "$REAL_OPENFANG" init --quick "$@"
fi

if [ "${1:-}" = "start" ] && [ "${2:-}" = "--daemon" ]; then
  shift 2
  nohup "$REAL_OPENFANG" start "$@" >/tmp/openfang.log 2>&1 &
  exit 0
fi

if [ "${1:-}" = "hand" ] && [ "${2:-}" = "list" ]; then
  hands_dir="${HOME:-/root}/.openfang/agents"
  if [ ! -d "$hands_dir" ]; then
    echo "No bundled Hands found" >&2
    exit 1
  fi

  echo "Bundled Hands"
  find "$hands_dir" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort | head -n 7
  exit 0
fi

exec "$REAL_OPENFANG" "$@"
