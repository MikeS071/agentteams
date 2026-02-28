#!/bin/bash
set -euo pipefail

CONFIG_DIR="/root/.openfang"
CONFIG_PATH="${CONFIG_DIR}/config.toml"
READY_PATH="${CONFIG_DIR}/config.ready"

echo "AgentTeams tenant container starting..."
echo "TENANT_ID: ${TENANT_ID:-}"

mkdir -p "${CONFIG_DIR}"
rm -f "${READY_PATH}"

echo "Waiting for OpenFang config injection at ${CONFIG_PATH}..."
until [[ -f "${CONFIG_PATH}" && -f "${READY_PATH}" ]]; do
  sleep 0.2
done

echo "OpenFang config detected. Starting OpenFang..."
exec openfang start
