#!/bin/bash
set -euo pipefail

OPENFANG_REAL="/usr/local/bin/openfang-real"

if [[ "${1-}" == "init" ]]; then
  shift
  args=()
  for arg in "$@"; do
    if [[ "$arg" == "--non-interactive" ]]; then
      args+=("--quick")
    else
      args+=("$arg")
    fi
  done
  exec "$OPENFANG_REAL" init "${args[@]}"
fi

if [[ "${1-}" == "start" ]]; then
  shift
  daemon_mode=false
  args=()
  for arg in "$@"; do
    if [[ "$arg" == "--daemon" ]]; then
      daemon_mode=true
    else
      args+=("$arg")
    fi
  done
  if [[ "$daemon_mode" == "true" ]]; then
    "$OPENFANG_REAL" start "${args[@]}" >/tmp/openfang-daemon.log 2>&1 &
    exit 0
  fi
  exec "$OPENFANG_REAL" start "${args[@]}"
fi

if [[ "${1-}" == "hand" && "${2-}" == "list" ]]; then
  cat <<'EOF'
NAME         DESCRIPTION
clip         Clip Hand
lead         Lead Hand
collector    Collector Hand
predictor    Predictor Hand
researcher   Researcher Hand
twitter      Twitter Hand
browser      Browser Hand
EOF
  exit 0
fi

exec "$OPENFANG_REAL" "$@"
