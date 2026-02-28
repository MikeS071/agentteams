# AgentSquads Tenant Container

Docker image for per-tenant AgentSquads containers. Currently runs a placeholder health endpoint — will be replaced with OpenFang once the binary is available.

## Build

```bash
docker build -t agentsquads/tenant:dev .
```

## Run

```bash
docker run -d -p 4200:4200 -e TENANT_ID=test agentsquads/tenant:dev
```

## Test

```bash
curl http://localhost:4200/health
# {"status":"healthy","tenant":"test","uptime":1.234}
```

## Local dev (docker-compose)

```bash
docker compose -f docker-compose.tenant.yml up --build
```

## Environment Variables

| Variable | Description |
|---|---|
| `TENANT_ID` | Unique tenant identifier |
| `PLATFORM_API_URL` | Platform API base URL |
| `PLATFORM_API_KEY` | Platform API key |
| `LLM_PROXY_URL` | LLM proxy endpoint |
