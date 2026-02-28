#!/bin/bash
set -euo pipefail

# Ensure daemon can boot even if no provider key was injected yet.
if [ -z "${GROQ_API_KEY:-}" ] && [ -z "${OPENROUTER_API_KEY:-}" ] && [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ] && [ -z "${DEEPSEEK_API_KEY:-}" ] && [ -z "${GEMINI_API_KEY:-}" ] && [ -z "${GOOGLE_API_KEY:-}" ] && [ -z "${TOGETHER_API_KEY:-}" ] && [ -z "${MISTRAL_API_KEY:-}" ] && [ -z "${FIREWORKS_API_KEY:-}" ]; then
  export GROQ_API_KEY="placeholder"
fi

# Start OpenFang in background
openfang start --daemon
node /usr/local/bin/openfang-proxy.js >/tmp/openfang-proxy.log 2>&1 &

# Wait for health
until curl -sf http://localhost:4200/healthz; do
  sleep 1
done

# Keep container running
exec tail -f /dev/null
