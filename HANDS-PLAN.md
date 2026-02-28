# AgentSquads — OpenFang Embedded Architecture (v4)

## Architecture

```
User → agentsquads.ai (Next.js)
         ↓
       Go API (auth, billing, multi-tenant routing)
         ↓
       OpenFang binary (per-tenant, port 4200+N)
       - 7 Hands + General Chat, 53 tools, 27 LLM providers
       - WASM sandbox, knowledge graph, scheduling
       - SQLite + vector memory, approval gates
       - OpenAI-compatible /v1/chat/completions
       - 140+ REST/WS/SSE endpoints

Agent Swarm (per-tenant):
       Coordinator → decomposes task → spawns Codex tmux agents
       Watchdog (5 min) → detects completion/failure → dispatcher chains next
       Phase gates → auto within phase, stop between
       Same proven infra: dispatch.py, watchdog, tmux, worktrees

Platform Admin → /admin (gated to platform admin)
         ↓
       Go API /admin/* endpoints
```

**Our layer:** Auth, billing/Stripe, multi-tenant, web UI, admin, swarm orchestration, docs.
**OpenFang:** Agent runtime, tools, Hands, memory, knowledge graph, scheduling, LLM routing, sandboxing.

---

## Phase 1: OpenFang Runtime (sequential)

### OF-01: Install OpenFang in Tenant Container
**Dir:** `infra/tenant-container/`
- Update Dockerfile: install OpenFang binary (~32MB)
- Install Codex CLI for swarm sub-agents
- Pre-run `openfang init --non-interactive`, expose port 4200
- Health check on `/healthz`
- **Deps:** None. **Est:** 2h

### OF-02: OpenFang Config & LLM Key Injection
**Dir:** `apps/api/orchestrator/`
- Generate per-tenant `openfang.toml`: LLM keys, default model, port, auth disabled, all Hands enabled
- Config on container volume, auto-start daemon on boot
- **Deps:** OF-01. **Est:** 2h

### OF-03: Tenant OpenFang Lifecycle Management
**Dir:** `apps/api/orchestrator/`
- Track instances: container ID → port. Start/stop/restart.
- Port allocation, health monitoring, auto-restart on failure
- SQLite data persisted on volume
- **Deps:** OF-02. **Est:** 2h

---

## Phase 2: API Layer (parallel after OF-03)

### OF-04: Chat Proxy → OpenFang
**Dir:** `apps/api/channels/`
- Forward `generateAssistantResponse()` to tenant's OpenFang `/v1/chat/completions`
- Pass through model choice, messages, metadata
- OpenFang handles tool calling, execution loop, memory
- SSE streaming, 180s timeout. Save messages to our DB.
- **Deps:** OF-03. **Est:** 3h

### OF-05: Credit & Billing System (Stripe)
**Dir:** `apps/api/billing/`
- Intercept OpenFang responses: extract token usage, deduct credits by model+tokens
- Pre-check credits (402 if insufficient). Log to `usage_events`.
- Free tier: 1M tokens or $10 credit on signup
- Stripe Checkout for top-ups: `POST /api/billing/checkout`
- Stripe webhook: `POST /api/billing/webhook` → add credits on payment
- Per-model pricing table in DB (provider cost + our margin)
- Customer portal link for CC management
- DB migration: `credit_transactions`, `model_pricing` tables
- **Deps:** OF-04. **Est:** 4h

### OF-06: Hands Management Proxy
**Dir:** `apps/api/hands/`
- Proxy to OpenFang's Hands API per tenant: list, activate, deactivate, pause, resume, status, settings, requirements
- Auth check, mount in main.go
- **Deps:** OF-03. **Est:** 2h

### OF-07: Hand Events & SSE Proxy
**Dir:** `apps/api/hands/`
- Connect to OpenFang SSE per tenant, fan out events to frontend
- Events: hand_started, tool_executing, tool_result, hand_completed, approval_required
- Endpoint: `GET /api/tenants/{id}/hands/events`
- **Deps:** OF-06. **Est:** 3h

### OF-08: Platform Admin API
**Dir:** `apps/api/admin/`
- Admin middleware (`is_platform_admin` flag on user)
- **Tenants:** list (status, credits, user count, container state), create (provisions container + OpenFang), detail (usage stats, active hands, storage), update, deactivate (stop container, preserve data), restart
- **Credits:** balance + transaction history, add/deduct with reason, platform-wide summary
- **Users:** list cross-tenant, detail (tenant, role, last login, usage), update role/tenant/active, deactivate, impersonate (short-lived token)
- **Metrics:** active tenants, total users, credits consumed, LLM cost, active Hands
- **Usage:** breakdown by tenant, model, time range
- **Models:** list with pricing, update markup, add new
- **Health:** per-tenant container + OpenFang status, disk, memory
- DB migration: `is_platform_admin` boolean, `credit_transactions` table
- **Deps:** OF-03. **Est:** 4h

### OF-09: Auth Providers & Signup Flow
**Dir:** `apps/web/src/` + `apps/api/`
- Re-enable all auth providers: Google, GitHub, Facebook, Email/password
- Signup flow: create account → auto-provision tenant container → load free credits → redirect to dashboard
- Container provisioning on first login (lazy)
- Remove email allowlist (open signup)
- `/signup` page working with all providers
- **Deps:** OF-03. **Est:** 3h

---

## Phase 3: Frontend (parallel after Phase 2)

### OF-10: Landing Page Fixes
**Dir:** `apps/web/src/app/`
- Add **Login** link to top nav header
- Add **Pricing** link to top nav → `/pricing`
- Add **Docs** link to top nav → `/docs`
- Fix `/signup` route — working signup page (not redirect)
- Update agent count to 8 (7 Hands + General Chat)
- Verify all 8 agent descriptions match OpenFang Hand capabilities
- Verify swarm section matches OF-23 implementation
- Verify channel section matches OF-25 (Telegram + WhatsApp real)
- Verify pricing section matches OF-11 page
- Every claim on the page must map to a working feature. No "Coming Soon" badges.
- **Deps:** None (start early, finalize after other tickets). **Est:** 2h

### OF-11: Pricing Page
**Dir:** `apps/web/src/app/pricing/`
- Public page: `/pricing`
- Model pricing table: all providers/models with input + output price per 1M tokens (our price including margin)
- Pull from DB via public API endpoint `GET /api/pricing`
- Free tier callout: "1M tokens or $10 free on signup"
- "Get Started Free" CTA
- FAQ: billing, spending limits, models, what counts as a token
- Match landing page dark theme
- **Deps:** OF-05. **Est:** 3h

### OF-12: User Billing & Usage Dashboard
**Dir:** `apps/web/src/app/dashboard/billing/`
- **Credit balance** card: current balance, tokens used this month, estimated cost
- **Usage chart:** daily token usage over 30 days (by model, stacked bar)
- **Transaction history:** credits added (payments) and deducted (usage)
- **Top-up button** → Stripe Checkout ($5, $20, $50, $100 presets + custom)
- **Per-agent usage breakdown:** which Hands consumed how many tokens
- **Spending alerts:** set notification threshold
- **Deps:** OF-05. **Est:** 3h

### OF-13: User Profile & Payment Settings
**Dir:** `apps/web/src/app/dashboard/settings/`
- **Profile:** name, email, avatar, timezone
- **Payment method:** manage CC via Stripe Customer Portal link
- **Notification preferences:** email alerts for billing, Hand completions
- **Delete account** with confirmation
- **Deps:** OF-05, OF-09. **Est:** 3h

### OF-14: Agent Grid → OpenFang Hands + General Chat
**Dir:** `apps/web/src/app/dashboard/chat/`
- Replace hardcoded `agents.ts` with OpenFang Hand definitions via proxy
- Add **General Chat** as 8th tile (conversational agent, web_search + web_fetch tools)
- Tile click → activates Hand. Settings gear → HAND.toml settings panel (select→dropdown, text→input, toggle→switch)
- Status badges: active (green pulse), paused (amber), idle (gray)
- **Bigger tiles, sticky selection** — agent tiles sized at minimum 140x140px (not cramped). Active selection highlighted with accent border + subtle glow, persists across chat sessions (stored in localStorage). Selected agent shown as active pill/badge above chat input. User stays on that agent until they explicitly pick a new one.
- Requirement status (✅/❌) with install instructions
- **Preserve and enhance AgentSetup wizard** — keep the existing guided setup flow (AgentSetup.tsx) where each agent has custom fields (topic, depth, format, etc.) that build a contextual first message. Enhance by: (1) pulling field definitions from HAND.toml settings instead of hardcoded agents.ts, (2) smarter defaults based on user history, (3) "Quick Start" templates per agent (e.g. Research: "Market analysis of...", Lead: "Find CTOs in SaaS..."). The wizard flow stays: pick agent → fill guided fields → auto-send first message with system prompt active.
- **Deps:** OF-06. **Est:** 3h

### OF-15: Hand Dashboard & Metrics
**Dir:** `apps/web/src/app/dashboard/hands/[id]/`
- Per-hand detail page: status, uptime, last run
- Metrics cards from HAND.toml dashboard config
- Run history: recent runs with duration, outcome, tool call count
- Knowledge graph summary (entity + relation counts)
- Schedule display with next run time
- Polls every 10s when active
- **Deps:** OF-06. **Est:** 3h

### OF-16: Chat ↔ OpenFang Integration
**Dir:** `apps/web/src/app/dashboard/chat/`
- Chat through OpenFang proxy — tools actually execute
- Tool execution indicators from SSE: "🔍 Searching...", "📄 Reading...", "💾 Storing..."
- Tool results collapsible (expandable sections)
- **Model selector dropdown in chat input** — pull full list of supported models from `GET /api/models` (all 27 providers). Show model name + provider. User selection persists across messages. Passed through to OpenFang for routing.
- Streaming response rendering
- **Full Markdown rendering** in agent messages: headers, bold/italic, code blocks (syntax highlighted), tables, lists, blockquotes, links. Use `react-markdown` + `remark-gfm` + `rehype-highlight`. User messages stay plain text.
- **Clickable follow-up tiles** — when agent output contains a "Follow-Up Menu" or numbered suggestions (e.g. "1. Dive deeper into X", "2. Compare with Y"), parse and render as clickable tile buttons below the message. Click sends that suggestion as the next user message automatically.
- **Deps:** OF-04, OF-07, OF-14. **Est:** 3h

### OF-17: Chat Scroll & UX Fixes
**Dir:** `apps/web/src/app/dashboard/chat/`
- Fix scroll: `min-h-0` on all flex parents
- Auto-scroll pinned to bottom unless user scrolled up
- "Jump to bottom" button on new content
- Progressive stream rendering, loading skeletons, error states, retry
- **Deps:** None. **Est:** 2h

### OF-18: Approval Queue UI
**Dir:** `apps/web/src/app/dashboard/`
- Pending approvals inline in chat as cards: action description, risk level, Approve/Reject buttons
- Also accessible from hand dashboard as a queue
- Powered by SSE events (OF-07)
- **Deps:** OF-07, OF-16. **Est:** 2h

### OF-19: Dashboard UI Overhaul — Apple Terminal Aesthetic
**Dir:** `apps/web/`
- **Dark mode default** — near-black bg (#0a0a0b), subtle borders (#1a1a1f)
- **macOS window chrome** — traffic light dots on cards/panels, rounded corners 12-16px
- **Terminal panels** — monospace for agent output/tool logs, subtle green/amber glow
- **Frosted glass sidebar** — `backdrop-blur-xl` + semi-transparent bg
- **Inter + SF Mono fonts** — clean Apple typography
- **Framer Motion** — card hovers, panel slides, page transitions
- **Muted accents** — green (active), amber (paused), blue (info), red (error)
- **Agent tiles** — icon, name, category badge, feature pills
- **Tool execution** — live terminal log panel
- Apply across: sidebar, chat, agents, billing, settings, admin, swarm
- **Deps:** None (start early). **Est:** 5h

### OF-20: Platform Admin UI
**Dir:** `apps/web/src/app/admin/`
- Admin-only routes (redirect non-admins)
- **Dashboard** (`/admin`): metrics cards (active tenants, users, credits consumed, LLM cost), activity feed
- **Tenants** (`/admin/tenants`): searchable table, detail page with usage chart + active hands + storage. Actions: create, edit, restart, deactivate
- **Users** (`/admin/users`): cross-tenant table, last login, role. Actions: edit, deactivate, impersonate
- **Credits** (`/admin/credits`): ledger, add/deduct form with reason, per-tenant balances
- **Models** (`/admin/models`): pricing table, edit markup, add new
- **Health** (`/admin/health`): per-tenant container + OpenFang status, disk, memory
- Admin link in sidebar (only visible to platform admins)
- Apple terminal aesthetic from OF-19
- **Deps:** OF-08, OF-19. **Est:** 5h

### OF-21: User Documentation (Nextra)
**Dir:** `apps/docs/` (existing Nextra from P8-03)
- `/docs` route — linked from landing page nav + dashboard sidebar
- **Getting Started:** signup → pick agent → first chat → results
- **Agents Guide:** each of the 8 agents — what it does, settings, example workflows
- **Swarm Guide:** how agent swarm works, coordinator pattern, monitoring
- **Billing:** credits, pricing, top-ups, spending limits
- **Channels:** setting up Telegram bot, WhatsApp Business, webchat
- **Deploy:** connecting Vercel + Supabase for Coder agent
- **Settings:** profile, payment methods, notifications
- **FAQ / Troubleshooting**
- **API Reference** (placeholder for programmatic access)
- Auto-generated model pricing table from DB
- **Deps:** None (content, start early). **Est:** 4h

### OF-22: Landing Page Audit — Feature Parity Verification
- Automated script/checklist verifying every landing page claim:
  - 8 agents → all 8 tiles load, activate, respond with tools
  - 3 channels → webchat works, Telegram bot responds, WhatsApp responds
  - $0 to start → free credits loaded on signup
  - Sign up (Google, GitHub, Facebook, Email) → all 4 providers work
  - Agent swarm → coordinator decomposes task, sub-agents spawn, progress visible
  - "Watch them work" → tool execution indicators in chat
  - "Pay per token" → billing deducts on usage
  - Vercel + Supabase deploy → Coder agent can deploy
  - Pricing section → `/pricing` page matches, model prices correct
  - Login/Signup links → both work from landing page
  - Docs link → `/docs` loads
- If any claim fails: the feature gets fixed (not the copy)
- Run as final integration test before launch
- **Deps:** All other tickets. **Est:** 2h

### OF-23: Agent Swarm — Coordinator & Real-Time Dashboard
**Dir:** `apps/api/swarm/` + `apps/web/src/app/dashboard/swarm/`

**Backend (Go API + tenant container):**
- Coordinator endpoint: `POST /api/swarm/tasks` — accepts complex task description
- Coordinator agent (OpenFang Researcher Hand or dedicated coordinator Hand) decomposes task into sub-tasks
- Sub-agent spawning inside tenant container using **Codex tmux** (same pattern as our proven infra):
  - Each sub-agent gets its own tmux session + git worktree
  - Watchdog process (runs every 5 min inside container) monitors tmux panes
  - Dispatcher logic: agent completes → watchdog detects → dispatcher finds next unblocked sub-task → spawns
  - Phase gates: auto-spawn within phase, stop between phases
  - Double-failure halt: fail twice on same sub-task → flag, don't retry
- Swarm lifecycle: `POST /api/swarm/tasks/{id}/pause`, `/cancel`, `/redirect`
- Per-agent token tracking: intercept each sub-agent's LLM calls, attribute to parent task
- Progress calculation: completed sub-tasks / total sub-tasks → percentage
- Cost tracking: sum token costs across all sub-agents in real time
- Adapt existing `dispatch.py` + `watchdog` scripts to run inside tenant container
- Install tmux + git in tenant container Dockerfile (OF-01)

**Frontend:**
- Swarm dashboard page: `/dashboard/swarm`
- **Task list:** active swarms with progress bars + cost
- **Task detail:** agent tree view matching the landing page terminal mock:
  ```
  coordinator  task: "Build landing page with auth"
  ├─ agent-1  ✓ scaffolding complete
  ├─ agent-2  writing auth components...
  ├─ agent-3  setting up Supabase schema...
  └─ agent-4  queued: writing tests
  Progress: ██████████░░░░░░ 62%
  Tokens used: 45,230 (~$0.18)
  ```
- Real-time updates via SSE (agent status changes, completion events)
- Per-agent controls: pause, cancel, redirect (sends message to agent)
- Terminal view: click any agent → see its tmux output
- Result view: when complete, show assembled output from all sub-agents
- **Deps:** OF-04, OF-07. **Est:** 6h

### OF-24: Vercel + Supabase Deploy Pipeline
**Dir:** `apps/api/deploy/` + `apps/web/src/app/dashboard/deploy/`

**Backend (Go API):**
- OAuth flow for Vercel: `GET /api/deploy/vercel/auth` → Vercel OAuth → store token per tenant
- OAuth flow for Supabase: `GET /api/deploy/supabase/auth` → Supabase OAuth → store token per tenant
- Deploy endpoint: `POST /api/deploy` — project name, repo/files, env vars
- Pipeline steps:
  1. Create Vercel project via API, push code
  2. Create Supabase project via Management API, run migrations
  3. Wire Supabase URL + anon key into Vercel env vars
  4. Trigger Vercel deploy, poll for completion
- Status tracking: `GET /api/deploy/{id}/status` — step-by-step progress
- Store deploy history in DB: `deployments` table (tenant_id, project_name, vercel_url, supabase_url, status, created_at)

**Frontend:**
- Deploy settings: `/dashboard/settings/deploy` — connect Vercel + Supabase accounts (OAuth buttons)
- Deploy history: `/dashboard/deploy` — list of deployments with status, URLs, timestamps
- Active deploy view: step-by-step progress (creating project → deploying → wiring DB → live)
- Environment vars editor per deployment
- Coder agent integration: when Coder Hand produces deployable code, offer "Deploy" button

- **Deps:** OF-05 (billing), OF-09 (auth). **Est:** 5h

### OF-25: Telegram + WhatsApp Channel Adapters
**Dir:** `apps/api/channels/` + `apps/web/src/app/dashboard/settings/`

**Backend:**
- Proxy to OpenFang's channel management API per tenant
- Telegram: user provides bot token → configure OpenFang Telegram adapter → verify with test message
- WhatsApp: user provides WhatsApp Business API credentials → configure OpenFang WhatsApp adapter → verify
- Channel status endpoint: `GET /api/tenants/{id}/channels` — connected channels with status

**Frontend:**
- Channel settings page: `/dashboard/settings/channels`
- Per-channel card: Webchat (always on), Telegram (connect/disconnect), WhatsApp (connect/disconnect)
- Setup wizard per channel: enter credentials → test connection → confirm
- Status indicators: connected (green), disconnected (gray), error (red)
- Same conversation context across all channels (OpenFang handles sync natively)

- **Deps:** OF-06. **Est:** 3h

### OF-26: AgentSquads Full Rebrand
**Dir:** `~/projects/agentsquads/` (entire repo)
- Rename all legacy brand references to `agentsquads` / `AgentSquads`
- Files: package.json, docker-compose files, Go module path, DB name, env var prefixes, service names
- Update all import paths in Go and TypeScript
- Rename DB to `agentsquads` (migration script + connection strings)
- Update Docker container/network names
- Update `SERVICE-SPEC.md`, `ROADMAP.md`, `TICKETS.md` headers
- Update OG meta tags, page titles, footer text
- Grep entire repo for any stale legacy brand references and fix
- **Deps:** None (do first to avoid merge conflicts). **Est:** 2h

### OF-27: User Onboarding Wizard
**Dir:** `apps/web/src/app/dashboard/onboarding/`
- Triggers on first login after signup (before regular dashboard)
- **Step 1:** Welcome — name, what brings you here (research/coding/leads/monitoring/social/other)
- **Step 2:** Pick your first agent — show 8 tiles, recommend based on Step 1 answer
- **Step 3:** Quick setup — render agent's key HAND.toml settings (3-4 fields, smart defaults)
- **Step 4:** First message — pre-populated chat prompt. "Send" drops into chat with agent activated and working.
- Progress dots, skip button, back button
- Stores completion flag — don't show again
- Confetti/subtle animation on "Your agent is working" moment
- Mobile responsive
- **Deps:** OF-09, OF-14. **Est:** 3h

---

## Spawn Waves

| Wave | Tickets | Count | After |
|------|---------|-------|-------|
| 1 | OF-01, OF-17, OF-19, OF-21 | 4 | immediate |
| 2 | OF-02, OF-10 | 2 | OF-01 |
| 3 | OF-03 | 1 | OF-02 |
| 4 | OF-04, OF-06, OF-08, OF-09 | 4 | OF-03 |
| 5 | OF-05, OF-07, OF-14, OF-15, OF-25 | 5 | Wave 4 |
| 6 | OF-11, OF-12, OF-13, OF-16, OF-20, OF-23, OF-24, OF-27 | 8 | Wave 5 |
| 0 (pre-wave) | OF-26 | 1 | before everything |
| 7 | OF-18, OF-22 | 2 | Wave 6 (final) |

## Estimates

| # | Description | Est |
|---|-------------|-----|
| OF-01 | OpenFang + Codex in tenant container | 2h |
| OF-02 | Config & LLM key injection | 2h |
| OF-03 | Tenant lifecycle management | 2h |
| OF-04 | Chat proxy to OpenFang | 3h |
| OF-05 | Credit & billing system (Stripe) | 4h |
| OF-06 | Hands management proxy | 2h |
| OF-07 | Events & SSE proxy | 3h |
| OF-08 | Platform admin API | 4h |
| OF-09 | Auth providers & signup flow | 3h |
| OF-10 | Landing page fixes | 2h |
| OF-11 | Pricing page | 3h |
| OF-12 | User billing/usage dashboard | 3h |
| OF-13 | User profile & payment settings | 3h |
| OF-14 | Agent grid → Hands + General Chat | 3h |
| OF-15 | Hand dashboard & metrics | 3h |
| OF-16 | Chat ↔ OpenFang integration | 3h |
| OF-17 | Chat scroll & UX fixes | 2h |
| OF-18 | Approval queue UI | 2h |
| OF-19 | UI overhaul — Apple terminal aesthetic | 5h |
| OF-20 | Platform admin UI | 5h |
| OF-21 | User documentation (Nextra) | 4h |
| OF-22 | Landing page audit — feature parity | 2h |
| OF-23 | Agent swarm — coordinator + dashboard | 6h |
| OF-24 | Vercel + Supabase deploy pipeline | 5h |
| OF-25 | Telegram + WhatsApp channel adapters | 3h |
| OF-26 | AgentSquads rebrand | 2h |
| OF-27 | User onboarding wizard | 3h |
| **Total** | **27 tickets** | **~88h** |

With 7 parallel agents across 7 waves: **~3-4 days**.
