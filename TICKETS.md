# AgentSquads — Implementation Tickets

> Derived from ROADMAP.md. Each ticket is sized for a single sub-agent session.
> Dependencies are explicit. Parallelizable tickets within a phase are marked ⚡.
> Tickets prefixed with phase number (e.g., P1-01).

---

## Phase 1: Foundation

### P1-01: Monorepo scaffold
**Priority:** Critical | **Estimate:** 2h | **Depends on:** nothing | ⚡ parallel with P1-02
**Brief:**
- Init monorepo: `apps/web` (Next.js 14, App Router, TypeScript), `apps/api` (Go service), `packages/shared` (types, utils)
- Package manager: pnpm workspaces
- Tailwind CSS + dark theme matching landing page palette (`--bg: #0a0a0f`, `--accent: #6c5ce7`, `--accent3: #00cec9`)
- ESLint + Prettier config
- `docker-compose.yml` for local dev (Postgres, Redis)
- GitHub repo: `agentsquads/agentsquads` (private)
- CI: GitHub Actions — lint, build, test on PR
**Acceptance:**
- `pnpm dev` boots Next.js on :3000
- `docker compose up` starts Postgres + Redis
- CI green on empty commit

### P1-02: Database schema + migrations
**Priority:** Critical | **Estimate:** 2h | **Depends on:** nothing | ⚡ parallel with P1-01
**Brief:**
- PostgreSQL schema using raw SQL migrations (no ORM):
  - `users` (id uuid PK, email, name, password_hash, provider, provider_id, created_at, updated_at)
  - `tenants` (id uuid PK, user_id FK unique, status enum[active/paused/suspended], container_id, created_at)
  - `sessions` (NextAuth session table)
  - `accounts` (NextAuth account table for OAuth)
  - `conversations` (id, tenant_id FK, created_at)
  - `messages` (id, conversation_id FK, role enum[user/assistant/system], content text, channel enum[web/telegram/whatsapp], metadata jsonb, created_at)
  - `usage_logs` (id, tenant_id FK, model, input_tokens int, output_tokens int, cost_cents int, margin_cents int, created_at)
  - `credits` (tenant_id FK unique, balance_cents int, free_credit_used bool, updated_at)
  - `models` (id, name, provider, provider_cost_input_per_m int, provider_cost_output_per_m int, markup_pct int, enabled bool)
- Migration runner script (apply in order)
- Seed script: insert default models with pricing
**Acceptance:**
- `pnpm db:migrate` applies all migrations
- `pnpm db:seed` inserts model pricing data
- Schema matches spec exactly

### P1-03: Auth (NextAuth.js)
**Priority:** Critical | **Estimate:** 3h | **Depends on:** P1-01, P1-02
**Brief:**
- NextAuth.js (Auth.js v5) with providers:
  - Email/password (credentials provider + bcrypt)
  - Google OAuth
  - GitHub OAuth
  - Facebook OAuth
  - X/Twitter OAuth
  - LinkedIn OAuth
- On first login: auto-create tenant row (status=active, container_id=null)
- Auto-credit: insert into `credits` (balance_cents=1000, free_credit_used=true)
- JWT session with `tenantId` claim
- Middleware: protect `/dashboard/*` and `/api/*` routes (same pattern as MC)
- Pages: `/signin`, `/signup` (dark theme, consistent with landing)
**Acceptance:**
- Sign up via email → user + tenant + credits created
- Sign in via Google → same flow
- Unauthenticated `/dashboard` → redirect to `/signin`
- JWT contains tenantId

### P1-04: OpenFang fork + Docker image
**Priority:** Critical | **Estimate:** 3h | **Depends on:** nothing | ⚡ parallel with P1-01
**Brief:**
- Fork `RightNow-AI/openfang` → `agentsquads/openfang` (private repo)
- Create `Dockerfile.tenant`:
  - Multi-stage: build OpenFang binary from source (Rust), copy to slim Debian/Alpine
  - Install: tmux, git, node (for tooling), python3
  - Default config: health endpoint on :4200, workspace at `/workspace`
  - ENV vars: `TENANT_ID`, `PLATFORM_API_URL`, `PLATFORM_API_KEY`, `LLM_PROXY_URL`
  - Entrypoint: `openfang start`
- Health check: `GET /health` returns 200
- Push to GitHub Container Registry (ghcr.io)
- Target image size: <150MB
**Acceptance:**
- `docker build -t agentsquads/openfang:dev .` succeeds
- `docker run` boots, health check returns 200 within 10s
- Image size < 150MB

### P1-05: Tenant container orchestrator
**Priority:** Critical | **Estimate:** 4h | **Depends on:** P1-04, P1-02
**Brief:**
- Go service (or module in `apps/api`): `TenantOrchestrator` interface
  ```go
  type TenantOrchestrator interface {
    Create(tenantID string) (containerID string, err error)
    Start(tenantID string) error
    Stop(tenantID string) error
    Destroy(tenantID string) error
    Health(tenantID string) (bool, error)
    Exec(tenantID string, cmd []string) (stdout string, err error)
  }
  ```
- Docker implementation (uses Docker API via socket):
  - Create: `docker create` with tenant labels, volume mount, env vars, network isolation
  - Network: each container on isolated bridge, can only reach platform API + LLM proxy
  - Volume: `/data/tenants/{tenantID}/workspace` mounted to `/workspace`
  - Resource limits: 512MB RAM, 0.5 CPU (configurable)
- On signup (triggered by auth hook): call `Create` + `Start`, write container_id to tenants table
- Startup target: container healthy within 30s of signup
**Acceptance:**
- API call creates container, starts it, health check green
- Container cannot reach other tenant containers
- Tenant table updated with container_id
- Container destroyed on tenant delete

### P1-06: LLM proxy service
**Priority:** Critical | **Estimate:** 4h | **Depends on:** P1-02
**Brief:**
- Go HTTP service listening on internal port (e.g., :8090)
- Route: `POST /v1/chat/completions` (OpenAI-compatible)
- Auth: `Authorization: Bearer {tenant_api_key}` → validate against tenants table
- Flow:
  1. Parse request (model, messages, stream)
  2. Look up model in `models` table → get provider, cost, markup
  3. Forward to provider (OpenAI, Anthropic, Google — use provider SDK or raw HTTP)
  4. Stream response back to caller
  5. On completion: count tokens (from provider response `usage` field)
  6. Calculate cost: `(input_tokens * cost_input / 1M) + (output_tokens * cost_output / 1M)`
  7. Calculate margin: `cost * markup_pct / 100`
  8. Insert into `usage_logs`
  9. Deduct from `credits.balance_cents`
  10. If balance <= 0 after deduction: return 402 on next request
- Support models: gpt-4o, gpt-4o-mini, claude-sonnet-4, claude-opus-4, gemini-2.0-flash
- Provider API keys stored in env vars (not per-tenant)
**Acceptance:**
- Tenant container calls proxy, gets streaming response
- usage_logs row created with correct token counts
- credits.balance_cents decremented
- 402 returned when balance is 0

### P1-07: Webchat (basic)
**Priority:** Critical | **Estimate:** 4h | **Depends on:** P1-01, P1-03, P1-05, P1-06
**Brief:**
- Dashboard page: `/dashboard/chat`
- React component: message list + input box
- WebSocket connection to tenant container (via platform API proxy)
- Streaming: render assistant tokens as they arrive
- Message persistence: save to `messages` table (via API route)
- Features: code block syntax highlighting (highlight.js or shiki), file upload (images/docs → forwarded to agent), auto-scroll, loading indicator
- Dark theme matching landing page
- Mobile responsive
**Acceptance:**
- User sends message → agent responds with streaming text
- Messages persist across page reloads
- Code blocks render with syntax highlighting
- Works on mobile

---

## Phase 2: Billing

### P2-01: Stripe integration
**Priority:** High | **Estimate:** 3h | **Depends on:** P1-03 | ⚡ parallel with P2-02
**Brief:**
- Stripe customer created on user signup (in auth hook, after tenant creation)
- Credit purchase page: `/dashboard/billing`
- Bundles: $10, $25, $50, $100 (Stripe Checkout sessions)
- Webhook endpoint: `POST /api/webhooks/stripe`
  - `checkout.session.completed` → credit tenant account
- Store Stripe customer ID in users table
**Acceptance:**
- User clicks "Buy $10" → Stripe Checkout → credits added
- Webhook processes reliably (idempotent)

### P2-02: Usage dashboard
**Priority:** High | **Estimate:** 3h | **Depends on:** P1-06 | ⚡ parallel with P2-01
**Brief:**
- Dashboard page: `/dashboard/usage`
- Charts: daily token usage (input vs output), cost by model, cumulative spend
- Table: recent usage logs (model, tokens, cost, timestamp)
- Balance display: prominent in dashboard header (all pages)
- Warnings: banner at 20%, 10%, 5% remaining
- Use Recharts or Chart.js (lightweight)
**Acceptance:**
- User sees real-time balance in header
- Usage chart shows actual data from usage_logs
- Warning banners appear at thresholds

### P2-03: Auto-pause + resume
**Priority:** High | **Estimate:** 2h | **Depends on:** P1-05, P1-06
**Brief:**
- LLM proxy: after deducting credits, if balance <= 0:
  - Return 402 with message "Credits exhausted"
  - Call orchestrator.Stop(tenantID) to pause container
  - Update tenant status to "paused"
- On credit purchase (Stripe webhook):
  - Update balance
  - If tenant status == "paused": call orchestrator.Start(tenantID), set status "active"
- Dashboard: when paused, show "Credits exhausted — top up to continue" with buy button
**Acceptance:**
- User hits $0 → container pauses → chat shows exhaustion message
- User buys credits → container resumes → chat works again

---

## Phase 3: Channels

### P3-01: Channel sync architecture
**Priority:** High | **Estimate:** 3h | **Depends on:** P1-07
**Brief:**
- Refactor message flow:
  - All inbound messages (any channel) → normalize to `{tenant_id, content, channel, metadata}`
  - Route to tenant container → get response
  - Fan-out response to all connected channels for that tenant
- Channel registry per tenant: `tenant_channels` table (tenant_id, channel enum, channel_user_id, linked_at, muted bool)
- Redis pub/sub: publish responses on `tenant:{id}:response` channel; each channel listener subscribes
**Acceptance:**
- Message from webchat → response delivered to webchat
- Architecture supports adding Telegram/WhatsApp as listeners without refactoring

### P3-02: Telegram bot
**Priority:** High | **Estimate:** 4h | **Depends on:** P3-01
**Brief:**
- Single bot: `@AgentSquadsBot` (create via BotFather)
- Webhook endpoint: `POST /api/channels/telegram`
- Account linking: user clicks "Connect Telegram" in dashboard → gets 6-digit code → sends `/link CODE` to bot → linked
- Message routing: bot receives message → lookup tenant by Telegram user_id → forward to container → respond
- Support: text, images (as file uploads), inline buttons for guided workflows
- Unlink: `/unlink` command or dashboard button
**Acceptance:**
- User links Telegram account from dashboard
- Messages on Telegram → agent responds
- Same conversation visible on webchat

### P3-03: WhatsApp integration
**Priority:** High | **Estimate:** 4h | **Depends on:** P3-01
**Brief:**
- Meta Cloud API (WhatsApp Business Platform)
- Webhook endpoint: `POST /api/channels/whatsapp`
- Account linking: user enters phone in dashboard → platform sends verification code via WhatsApp → user confirms
- Message routing: same pattern as Telegram (phone → tenant lookup)
- Template messages for outbound after 24h window (Meta requirement)
- Support: text, images, documents
**Acceptance:**
- User links WhatsApp from dashboard
- Messages on WhatsApp → agent responds
- Conversation synced across all channels

### P3-04: Channel management UI
**Priority:** Medium | **Estimate:** 2h | **Depends on:** P3-02, P3-03
**Brief:**
- Dashboard page: `/dashboard/settings/channels`
- Show connected channels with status (linked/unlinked)
- Connect buttons for each channel with guided flow
- Mute toggle per channel
- Unlink button
**Acceptance:**
- User sees all channel statuses
- Can link/unlink/mute from one page

---

## Phase 4: Guided Workflows

### P4-01: Workflow template engine
**Priority:** High | **Estimate:** 4h | **Depends on:** P1-07
**Brief:**
- Template parser: reads TOML workflow definitions
- Template runner: state machine that steps through workflow
  - Step types: `text` (free input), `choice` (buttons/select), `confirm` (summary + launch), `file_upload`
  - Cost estimation: simple heuristic based on depth selection
- Webchat renderer: renders steps as interactive form elements inline in chat
- Channel renderer: sends steps as sequential messages with reply buttons (Telegram) or list messages (WhatsApp)
- On confirm: compile inputs into structured task brief → send to agent
- Store: `workflow_runs` table (id, tenant_id, workflow_id, inputs jsonb, status, created_at)
**Acceptance:**
- Define a workflow in TOML → engine renders it in webchat
- User completes all steps → structured brief sent to agent
- Same flow works in Telegram

### P4-02: Hand catalog UI
**Priority:** High | **Estimate:** 3h | **Depends on:** P4-01
**Brief:**
- Dashboard page: `/dashboard/catalog`
- Grid layout: cards for each Hand (image, name, description, [Start] button)
- Uses same tile images from landing page
- Search/filter by category
- "Just chat" option prominent alongside catalog
- Admin flag: `hand_enabled` per tenant (default all enabled)
- Click [Start] → opens guided workflow inline in chat view
**Acceptance:**
- User browses catalog, clicks Start on Research → guided flow begins
- Freeform chat always accessible

### P4-03: Starter workflow templates
**Priority:** High | **Estimate:** 3h | **Depends on:** P4-01 | ⚡ parallel with P4-02
**Brief:**
- Author TOML workflow templates as defined in SERVICE-SPEC.md:
  1. `research.toml` — topic, depth, format, sources, confirm
  2. `coder.toml` — description, stack, deploy target, confirm
  3. `leadgen.toml` — ICP, industry, frequency, output format, confirm
  4. `intel.toml` — target, monitoring frequency, alert triggers, confirm
  5. `social.toml` — platform, tone, frequency, approval mode, confirm
  6. `browser.toml` — task description, target URL, approval gate, confirm
  7. `clip.toml` — video URL, style, length, output, confirm
- Each template includes: cost estimate hints, default values, help text
- Store in: `data/workflows/` directory in repo
**Acceptance:**
- All templates parse without error
- Each renders correctly in webchat and Telegram

---

## Phase 5: Agent Swarm & Terminal

### P5-01: Coordinator agent pattern
**Priority:** High | **Estimate:** 5h | **Depends on:** P1-05
**Brief:**
- Within tenant container: coordinator agent is the main OpenFang agent
- Task decomposition: coordinator receives complex task → breaks into sub-tasks
- Sub-agent protocol:
  - Coordinator creates tmux session: `tmux new-session -d -s agent-{taskId}`
  - Writes task brief to `/workspace/swarm/{taskId}/TASK.md`
  - Launches sub-agent process in tmux session
  - Monitors: polls tmux pane output + checks for `/workspace/swarm/{taskId}/DONE` marker
  - Collects: reads `/workspace/swarm/{taskId}/output/` directory
  - Merges results and responds to user
- Config: max concurrent sub-agents (default 3, admin-configurable per tenant)
- Cleanup: kill tmux sessions on completion or timeout (default 30min)
**Acceptance:**
- User sends complex task → coordinator spawns 2+ sub-agents
- Sub-agents work independently in separate tmux sessions
- Coordinator collects and merges results
- Cleanup happens on completion

### P5-02: Swarm dashboard
**Priority:** High | **Estimate:** 4h | **Depends on:** P5-01, P1-07
**Brief:**
- Dashboard page: `/dashboard/swarm`
- Real-time view via WebSocket:
  - Active agents: name, task, status (running/complete/failed), progress
  - Expand agent: live output stream (from tmux pane)
- Controls: pause, cancel, restart individual agents
- History: past swarm runs with results, token cost per agent
- Summary card: total active agents, total tokens, estimated cost
**Acceptance:**
- User sees live swarm status updating in real time
- Can expand an agent to see its live output
- Can cancel a running agent

### P5-03: Web terminal
**Priority:** High | **Estimate:** 3h | **Depends on:** P1-05
**Brief:**
- Dashboard page: `/dashboard/terminal`
- xterm.js (v5) with WebGL renderer
- WebSocket bridge: dashboard → platform API → `orchestrator.Exec()` → container shell
- Auth: verify tenant owns the container
- Features: copy/paste, resize, scrollback buffer
- Admin policy: `terminal_enabled` flag per tenant (default true)
**Acceptance:**
- User opens terminal → gets shell in their container
- Can run commands, inspect workspace, see agent files
- Terminal disabled when admin flag is false

### P5-04: Swarm status in channels
**Priority:** Medium | **Estimate:** 2h | **Depends on:** P5-01, P3-01
**Brief:**
- When swarm is active, coordinator sends progress updates via channel fan-out
- Format: "🤖 3 agents working: Agent 1 ✅ done, Agent 2 🔄 writing tests, Agent 3 ⏳ queued"
- Update frequency: on sub-agent status change (not polling)
- Final result: consolidated message with summary + key outputs
**Acceptance:**
- User launches swarm from Telegram → gets progress updates there
- Final result delivered as single message

---

## Phase 6: Build & Deploy

### P6-01: Vercel + Supabase OAuth connections
**Priority:** Medium | **Estimate:** 3h | **Depends on:** P1-03
**Brief:**
- Dashboard settings: `/dashboard/settings/deploy`
- Vercel OAuth: connect user's Vercel account, store encrypted access token
- Supabase OAuth: connect user's Supabase org, store encrypted access token
- Display: connected status, linked projects list
- Token encryption: AES-256-GCM, key from env var
**Acceptance:**
- User connects Vercel account via OAuth
- User connects Supabase account via OAuth
- Tokens stored encrypted, retrievable for deploy operations

### P6-02: Deploy pipeline
**Priority:** Medium | **Estimate:** 5h | **Depends on:** P6-01, P5-01
**Brief:**
- Agent capability: when Coder hand completes a build:
  1. Scaffold: Next.js + Supabase project in `/workspace/builds/{project}/`
  2. Build: `npm run build` in container
  3. Test: basic smoke test (build succeeds, no TS errors)
  4. Deploy to Vercel: use Vercel API (create project, push deployment)
  5. Supabase: run migrations via Supabase CLI using stored token
  6. Report: return live URL + dashboard links to user
- Dashboard page: `/dashboard/deployments`
  - List: project name, status (building/live/failed), URL, timestamp
  - Logs: build + deploy output
  - Rollback: re-deploy previous version
**Acceptance:**
- Agent builds project → deploys to user's Vercel → returns live URL
- User sees deployment status in dashboard
- Rollback works

---

## Phase 7: Admin Panel

### P7-01: Admin auth + dashboard shell
**Priority:** High | **Estimate:** 2h | **Depends on:** P1-03
**Brief:**
- Admin role in users table (`is_admin bool`)
- Admin routes: `/admin/*` (protected by middleware — require is_admin)
- Admin dashboard shell: sidebar nav (Users, Billing, Models, Infra, Policies)
- MFA: TOTP via authenticator app (optional but recommended)
**Acceptance:**
- Admin can log in and see admin dashboard
- Non-admin gets 403 on `/admin/*`

### P7-02: User management
**Priority:** High | **Estimate:** 3h | **Depends on:** P7-01
**Brief:**
- Admin page: `/admin/users`
- List: all tenants with search, filter by status/signup date/usage
- Detail view: usage history, connected channels, container health, credit balance
- Actions: suspend, unsuspend, delete tenant, grant credits (amount input), impersonate (read-only view of their dashboard)
**Acceptance:**
- Admin can search users, view details, suspend/grant credits

### P7-03: RBAC / feature policy
**Priority:** High | **Estimate:** 2h | **Depends on:** P7-01
**Brief:**
- `tenant_policies` table: tenant_id, feature enum, enabled bool
- Features: swarm, terminal, deploy, each Hand individually, each channel
- Admin page: `/admin/policies`
- Global defaults (new signups get all features)
- Per-tenant override
- Platform API checks policy before allowing feature access
**Acceptance:**
- Admin disables terminal for a tenant → terminal returns 403 for that user
- New signups get all features by default

### P7-04: Model + margin config
**Priority:** Medium | **Estimate:** 2h | **Depends on:** P7-01, P1-06
**Brief:**
- Admin page: `/admin/models`
- Table: all models with provider cost, markup %, user price (calculated), enabled toggle
- Edit: change markup %, enable/disable — saved immediately
- Add new model: form with provider, costs, markup
- Changes reflected on next LLM proxy request (no restart)
**Acceptance:**
- Admin changes GPT-4o markup from 30% to 35% → next user request uses new margin

### P7-05: Billing admin + infra monitoring
**Priority:** Medium | **Estimate:** 3h | **Depends on:** P7-01, P2-01
**Brief:**
- Admin page: `/admin/billing`
  - Revenue: daily/weekly/monthly charts
  - Margin: cost vs revenue per model
  - Per-tenant: spending, credits granted, refunds
  - Alerts: unusual usage spikes
- Admin page: `/admin/infra`
  - Container list: status (running/stopped), CPU, RAM, disk
  - Alerts: crash, high resource, provisioning failure
  - Scaling indicator: "consider adding nodes" threshold
**Acceptance:**
- Admin sees total revenue, margin by model, per-tenant spend
- Admin sees container health for all tenants

---

## Phase 8: Launch Prep

### P8-01: Security hardening
**Priority:** Critical | **Estimate:** 4h | **Depends on:** all previous phases
**Brief:**
- Container isolation: seccomp profiles, rootless, no `--privileged`
- Network: containers can only reach LLM proxy + platform API (iptables/network policy)
- Auth: pen test OAuth flows, JWT validation, CSRF
- LLM proxy: input validation, rate limiting (100 req/min/tenant default)
- Encrypted at rest: volume encryption
- TLS: everywhere (Cloudflare → platform, platform → containers)
- Secrets audit: no hardcoded keys in repo
**Acceptance:**
- Security checklist fully passed
- No container escape possible
- Rate limiting enforced

### P8-02: Load testing
**Priority:** High | **Estimate:** 3h | **Depends on:** P8-01
**Brief:**
- Simulate 50 concurrent tenants with mixed workloads
- Measure: container startup time (<30s), LLM proxy p99 latency (<500ms), WebSocket stability
- Tools: k6 or custom Go load generator
- Identify bottlenecks, set auto-scaling thresholds
- Document results + capacity plan
**Acceptance:**
- Platform handles 50 concurrent tenants without degradation
- Capacity plan written with scaling triggers

### P8-03: Documentation site
**Priority:** High | **Estimate:** 3h | **Depends on:** P4-03 | ⚡ parallel with P8-01
**Brief:**
- Docs site: `docs.agentsquads.ai` (or `/docs` route)
- Framework: Nextra, Mintlify, or simple MDX pages
- Content:
  - Getting started (signup → first chat → connect channels)
  - Agent catalog (each Hand with examples)
  - Guided workflows (how templates work)
  - Swarm (how it works, monitoring)
  - Terminal (access, commands)
  - Deploy (connecting Vercel/Supabase, deployment flow)
  - Billing (credits, usage, pricing)
  - API reference (for power users)
**Acceptance:**
- Docs site live with all sections
- Each Hand has at least one usage example

### P8-04: Landing page production
**Priority:** High | **Estimate:** 2h | **Depends on:** P1-01
**Brief:**
- Convert static HTML mockup to Next.js pages (SSR for SEO)
- Add: signup form (connects to auth), pricing calculator (model × tokens → estimated cost), demo video embed
- SEO: meta tags, Open Graph, Twitter cards, sitemap, robots.txt
- Analytics: Plausible or PostHog
- Deploy to production domain
**Acceptance:**
- Landing page renders server-side with proper meta tags
- Signup form works end-to-end
- Indexed by Google within 1 week

---

## Ticket Summary

| Phase | Tickets | Total Est. Hours | Parallelizable |
|-------|---------|-----------------|----------------|
| 1. Foundation | 7 | 22h | P1-01, P1-02, P1-04 parallel |
| 2. Billing | 3 | 8h | P2-01, P2-02 parallel |
| 3. Channels | 4 | 13h | P3-02, P3-03 parallel |
| 4. Workflows | 3 | 10h | P4-02, P4-03 parallel |
| 5. Swarm + Terminal | 4 | 14h | P5-02, P5-03 parallel |
| 6. Deploy | 2 | 8h | — |
| 7. Admin | 5 | 12h | P7-02, P7-03 parallel |
| 8. Launch | 4 | 12h | P8-01, P8-03 parallel |
| **Total** | **32 tickets** | **~99h** | |

### Optimal Swarm Execution (3 concurrent agents)

With 3 sub-agents running in parallel:

| Week | Agents working on |
|------|------------------|
| 1 | P1-01 + P1-02 + P1-04 (parallel foundation) |
| 1–2 | P1-03 + P1-05 + P1-06 (auth + orchestrator + proxy) |
| 2 | P1-07 (webchat, needs all above) |
| 3 | P2-01 + P2-02 + P2-03 (billing, mostly parallel) |
| 3–4 | P3-01 + P3-02 + P3-03 (channels, parallel after sync arch) |
| 4 | P3-04 + P4-01 + P4-03 (channel UI + workflow engine + templates) |
| 5 | P4-02 + P5-01 + P5-03 (catalog + coordinator + terminal) |
| 5–6 | P5-02 + P5-04 + P6-01 (swarm dashboard + channel status + deploy OAuth) |
| 6–7 | P6-02 + P7-01 + P7-02 (deploy pipeline + admin shell + user mgmt) |
| 7–8 | P7-03 + P7-04 + P7-05 (policies + models + billing admin) |
| 8–9 | P8-01 + P8-03 + P8-04 (security + docs + landing prod) |
| 9 | P8-02 (load test — needs everything stable) |

**Estimated wall-clock: ~9 weeks with 3 concurrent agents.**

---

*Generated: 2026-02-27 | Author: Navi | Status: Ready for execution*
