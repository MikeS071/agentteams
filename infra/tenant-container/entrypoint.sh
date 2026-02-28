#!/bin/bash
set -euo pipefail

# Start OpenFang in background
openfang start --daemon

# Bridge /healthz on :4200 to OpenFang's /health on :4201
node /usr/local/bin/openfang-port-proxy.js &

# Wait for health
until curl -sf http://localhost:4200/healthz; do
  sleep 1
done

# Keep container alive
exec tail -f /dev/null
