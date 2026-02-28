# Load Testing (k6)

This folder contains load-test infrastructure for validating AgentTeams under multi-tenant load.

## Scenarios

1. `01-signup-tenant-chat.js`
- 50 concurrent users
- Flow: signup -> credentials login (tenant creation) -> first chat message
- Auth target: p99 < 200ms for signup/login

2. `02-chat-sessions.js`
- 50 concurrent chat sessions
- Mixed message lengths (short/medium/long)
- Includes optional websocket stability executor for terminal channel load (`WS_VUS>0`, typically `WS_VUS=50` and `WS_DURATION=60m`)

3. `03-container-provisioning.js`
- 10 concurrent container resume/provisioning requests
- Startup target: p95 < 30s

4. `04-llm-proxy.js`
- 100 concurrent LLM proxy requests
- Captures usage token counts from proxy response
- Proxy latency target: p99 < 500ms (configure `INFERENCE_BUDGET_MS` to subtract model inference budget)

## Prerequisites

- k6 installed locally (`k6 version`)
- Running platform services:
- Web app reachable at `WEB_BASE_URL` (default `http://localhost:3000`)
- API reachable at `API_BASE_URL` (default `http://localhost:8080`)
- Tenant IDs available for scenarios 3/4 (and websocket), via `TENANT_IDS`

## Quick Validation

```bash
k6 inspect tests/load/scenarios/01-signup-tenant-chat.js
k6 inspect tests/load/scenarios/02-chat-sessions.js
k6 inspect tests/load/scenarios/03-container-provisioning.js
k6 inspect tests/load/scenarios/04-llm-proxy.js

docker compose -f docker-compose.loadtest.yml config
```

## Local Run (CLI)

```bash
mkdir -p tests/load/results

export WEB_BASE_URL="http://localhost:3000"
export API_BASE_URL="http://localhost:8080"
export TENANT_IDS="tenant-uuid-1,tenant-uuid-2,tenant-uuid-3"
export WS_TENANT_IDS="$TENANT_IDS"

k6 run tests/load/scenarios/01-signup-tenant-chat.js \
  --out json=tests/load/results/01-signup-tenant-chat.json \
  --summary-export tests/load/results/01-signup-tenant-chat.summary.json

k6 run tests/load/scenarios/02-chat-sessions.js \
  --out json=tests/load/results/02-chat-sessions.json \
  --summary-export tests/load/results/02-chat-sessions.summary.json

k6 run tests/load/scenarios/03-container-provisioning.js \
  --out json=tests/load/results/03-container-provisioning.json \
  --summary-export tests/load/results/03-container-provisioning.summary.json

k6 run tests/load/scenarios/04-llm-proxy.js \
  --out json=tests/load/results/04-llm-proxy.json \
  --summary-export tests/load/results/04-llm-proxy.summary.json
```

Generate markdown report:

```bash
node tests/load/scripts/generate-report.mjs tests/load/results tests/load/results/loadtest-report.md
```

## Docker Compose Stack (k6 + InfluxDB + Grafana)

Start visualization services:

```bash
docker compose -f docker-compose.loadtest.yml up -d influxdb grafana
```

Open Grafana at `http://localhost:3001` (`admin` / `admin`).
Datasource `InfluxDB-k6` is auto-provisioned.

Run a scenario from the k6 container:

```bash
docker compose -f docker-compose.loadtest.yml run --rm k6 \
  k6 run tests/load/scenarios/04-llm-proxy.js --out influxdb=http://influxdb:8086/k6
```

## CI (Manual)

Workflow: `.github/workflows/loadtest.yml`

- Trigger manually from GitHub Actions (`workflow_dispatch`)
- Always validates:
- `k6 inspect` for all scenario scripts
- `docker compose -f docker-compose.loadtest.yml config`
- Optional full scenario execution with input `run_scenarios=true`
- Uploads JSON + summary + markdown report as artifact

## Useful Environment Variables

- `WEB_BASE_URL`, `API_BASE_URL`
- `TENANT_IDS` (required for scenarios 3/4)
- `WS_TENANT_IDS` (optional override for websocket scenario)
- `LLM_MODEL` (default `gpt-4o-mini`)
- `INFERENCE_BUDGET_MS` (subtract from measured proxy latency)
- `CHAT_DURATION`, `WS_DURATION`, `CONTAINER_DURATION`, `LLM_DURATION`
