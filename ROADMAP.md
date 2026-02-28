# AgentSquads — Implementation Roadmap

> Derived from SERVICE-SPEC.md v1.0. Stories are sequenced by dependency, not arbitrary sprints.
> Each phase has a clear "done" gate before the next begins.

---

## Phase 1: Foundation (Weeks 1–3)

**Goal:** User can sign up, get a container, and talk to an agent via webchat.

### P1-1: Project scaffold
- Next.js app with App Router (dashboard + marketing pages)
- PostgreSQL schema: tenants, users, sessions, usage_logs
- Go API service (or Next.js API routes — decide during P1-1)
- Monorepo structure: `apps/web`, `apps/api`, `packages/shared`
- CI: GitHub Actions (lint, build, test)
- **Done:** `pnpm dev` boots dashboard + API, connects to local Postgres

### P1-2: Auth
- NextAuth.js with 5 providers: Email/password, Google, GitHub, Facebook, X/LinkedIn
- JWT sessions + refresh tokens
- User table: id, email, name, provider, created_at
- Tenant auto-provisioned on first login (1:1 user:tenant)
- **Done:** User can sign up via Google, lands on empty dashboard

### P1-3: OpenFang fork + container image
- Fork `RightNow-AI/openfang` → private `agentsquads/openfang` repo
- Build Docker image: OpenFang binary + base config + workspace volume mount
- Slim image target: <100MB
- Test: `docker run agentsquads/openfang` boots and responds to health check
- **Done:** Container image in private registry, boots in <5s

### P1-4: Tenant provisioning
- On signup: API calls Docker to create tenant container
- Container config: tenant_id label, mounted volume for workspace, env vars for platform API callback
- Container lifecycle: create, start, stop, destroy
- Health check endpoint per container
- Abstraction layer: `TenantOrchestrator` interface (Docker impl now, K8s impl later)
- **Done:** Signup → container running within 30s, health check green

### P1-5: LLM proxy
- Go service (or extend existing AiPipe pattern)
- Routes: `/v1/chat/completions` (OpenAI-compatible)
- Auth: tenant API key in header → validate → route to provider
- Token counting: tiktoken (or provider response usage field)
- Logging: tenant_id, model, input_tokens, output_tokens, cost, timestamp → Postgres
- Model config table: model_id, provider, provider_cost_input, provider_cost_output, markup_pct, enabled
- **Done:** Tenant container can call proxy, tokens counted and logged

### P1-6: Webchat (basic)
- Chat component in dashboard (React + WebSocket)
- Messages stored: tenant_id, role, content, channel, timestamp
- Streaming responses from agent
- File upload (images, documents) → forwarded to agent
- Code block rendering with syntax highlighting
- **Done:** User can chat with their agent in browser, see streaming responses

**Phase 1 gate:** User signs up → container provisioned → chats with agent via web → tokens metered.

---

## Phase 2: Billing & Free Tier (Weeks 3–4)

**Goal:** Users get free credits, can top up, auto-pause when exhausted.

### P2-1: Stripe integration
- Stripe customer created on signup
- Credit purchase: $10, $25, $50, $100 bundles (Stripe Checkout)
- Webhook handler: payment_intent.succeeded → credit user account
- **Done:** User can buy credits via Stripe

### P2-2: Credit system
- Tenant balance table: tenant_id, balance_cents, last_updated
- LLM proxy deducts after each request (cost + markup)
- Real-time balance in dashboard header
- **Done:** Balance decrements on each LLM call

### P2-3: Free tier
- On signup: auto-credit 1M tokens OR $10 (whichever is greater, compute at signup based on default model pricing)
- Flag: `free_credit_used` (one-time only)
- **Done:** New user sees $10+ balance without paying

### P2-4: Usage limits & auto-pause
- Warnings at 20%, 10%, 5% remaining balance (in-app notification + email)
- At $0: container paused (not destroyed), agent stops responding
- Dashboard shows: "Credits exhausted — top up to continue"
- Admin override: grant credits manually
- **Done:** User hits zero → agent pauses → tops up → agent resumes

### P2-5: Usage dashboard
- User view: token usage by model, daily/weekly/monthly charts, cost breakdown
- Admin view: aggregate usage, revenue, margin, per-tenant breakdown
- Export: CSV download
- **Done:** User can see where their tokens went

**Phase 2 gate:** Full billing loop — free credits → usage → exhaustion → top-up → resume.

---

## Phase 3: Channels (Weeks 4–6)

**Goal:** Telegram + WhatsApp connected, all channels in sync with webchat.

### P3-1: Channel sync architecture
- Conversation store: all messages tagged with `channel` (web/telegram/whatsapp)
- Fan-out: agent response sent to all connected channels
- Dedup: if user sends same message from two channels simultaneously, handle gracefully
- Mute per channel: user can disable notifications on specific channels
- **Done:** Architecture implemented, webchat uses it

### P3-2: Telegram integration
- Single AgentSquads bot (BotFather)
- Account linking: user clicks "Connect Telegram" in dashboard → gets one-time code → sends to bot → linked
- Message routing: bot receives message → lookup tenant by Telegram user ID → forward to container
- Response routing: agent response → bot sends to user's Telegram
- Supported: text, images, files, code blocks, inline buttons
- **Done:** User chats on Telegram, sees same conversation on web

### P3-3: WhatsApp integration
- Meta Cloud API (WhatsApp Business)
- Business verification with Meta (start early — 1–2 week lead time)
- Account linking: user enters phone number in dashboard → receives verification message
- Message routing: same pattern as Telegram (phone number → tenant lookup)
- Template messages for notifications (Meta requirement for outbound after 24h)
- **Done:** User chats on WhatsApp, synced with web + Telegram

### P3-4: Channel status UI
- Dashboard shows: connected channels with status indicators
- "Connect" buttons for each channel with guided linking flow
- Channel activity: last message per channel, online/offline
- **Done:** User sees all their channels and connection status

**Phase 3 gate:** User can message from any channel, get responses on all, conversation stays in sync.

---

## Phase 4: Guided Workflows & Hand Catalog (Weeks 6–8)

**Goal:** Users discover and launch Hands via guided step-by-step flows.

### P4-1: Workflow template engine
- Template format: TOML (as specced)
- Template runner: parses steps, renders in UI, collects inputs, passes to agent
- Step types: `text`, `choice`, `confirm`, `file_upload`
- Cost estimation: estimate tokens based on depth/complexity selection
- Works on webchat (form/wizard) and channels (sequential messages with buttons)
- **Done:** Engine can run any valid template definition

### P4-2: Hand catalog UI
- Dashboard page: grid/list of available Hands with emoji, name, description
- Each card: [Start] button → launches guided flow
- Search/filter by category
- Admin toggle: enable/disable Hands globally or per-tenant
- **Done:** User browses catalog, clicks Start, enters guided flow

### P4-3: Starter workflow templates
- Research Assistant (topic → depth → format → sources → confirm)
- Coder (description → stack → deploy target → confirm)
- Lead Generator (ICP description → industry → frequency → output format → confirm)
- Intelligence Collector (target → monitoring frequency → alert triggers → confirm)
- Social Manager (platform → tone → posting frequency → approval mode → confirm)
- Browser Agent (task description → target URL → approval gate → confirm)
- Clip Creator (video URL → style → length → output → confirm)
- Predictor (question → timeframe → contrarian mode → confidence threshold → confirm)
- **Done:** All 8 starter templates authored and tested

### P4-4: Freeform fallback
- User can always skip guided flow and just type in chat
- "Just chat" option visible alongside Hand catalog
- Agent handles unstructured requests using its own judgment
- **Done:** Both paths (guided + freeform) work seamlessly

### P4-5: Custom workflow templates (admin)
- Admin can create/edit workflow templates from admin panel
- TOML editor with preview
- Publish to specific tenants or all tenants
- **Done:** Admin creates a custom workflow, user sees it in catalog

**Phase 4 gate:** Non-technical user can pick "Research Assistant," follow 4 steps, launch autonomous research, get results in chat.

---

## Phase 5: Agent Swarm & Terminal (Weeks 8–10)

**Goal:** Coordinator + sub-agents visible and controllable. Terminal for power users.

### P5-1: Coordinator agent pattern
- Main agent in container acts as coordinator
- Task decomposition: break user request into sub-tasks
- Sub-agent spawning: coordinator creates tmux sessions with task briefs
- Result collection: coordinator monitors sub-agents, merges outputs
- Configurable concurrency: max sub-agents per tenant (admin-controlled, default 3)
- **Done:** Coordinator can decompose a task and delegate to sub-agents

### P5-2: tmux sub-agent management
- Spawn: `tmux new-session -d -s agent-{id}` with task brief piped in
- Monitor: parse tmux pane output for status/completion signals
- Collect: sub-agent writes results to workspace, coordinator reads
- Cleanup: kill session on completion or timeout
- Workspace isolation: each sub-agent gets own directory / git worktree
- **Done:** Sub-agents run independently, coordinator collects results

### P5-3: Swarm dashboard
- Real-time view: which agents are running, what task, % progress
- Per-agent: expand to see live output (streamed from tmux)
- Controls: pause, cancel, restart individual agents
- History: completed swarm runs with results and token cost
- **Done:** User can watch their agent swarm work in real time

### P5-4: Web terminal
- xterm.js in browser
- WebSocket bridge to tenant container shell
- Auth: only tenant owner can access their terminal
- Admin policy: enable/disable terminal per tenant
- Command allowlist/denylist (optional, admin-configured)
- **Done:** User opens terminal tab, gets shell in their agent environment

### P5-5: Swarm in channels
- Telegram/WhatsApp: coordinator sends progress updates as messages
- "3 agents working on your request. Agent 1: scaffolding... Agent 2: writing tests..."
- Final result delivered as a single consolidated message
- **Done:** Swarm status visible in all channels

**Phase 5 gate:** User requests a complex task → swarm activates → visible in dashboard + channels → results delivered.

---

## Phase 6: Build & Deploy (Weeks 10–11)

**Goal:** Agent can scaffold, build, and deploy apps to user's Vercel/Supabase.

### P6-1: Vercel OAuth
- User connects Vercel account from dashboard (OAuth flow)
- Store access token per tenant (encrypted)
- List user's Vercel projects
- **Done:** Vercel connected, token stored

### P6-2: Supabase OAuth
- User connects Supabase account from dashboard
- Store access token per tenant (encrypted)
- List user's Supabase projects
- **Done:** Supabase connected, token stored

### P6-3: Deploy pipeline
- Agent scaffolds project (Next.js + Supabase by default)
- Build step: `npm run build` in container
- Test step: basic smoke tests
- Deploy: push to Vercel via API (or git push to connected repo)
- Supabase: run migrations, seed data via Supabase CLI
- **Done:** Agent builds and deploys a working app end-to-end

### P6-4: Deployment dashboard
- Status: deploying, live, failed
- Logs: build + deploy output
- Links: live URL, Vercel dashboard, Supabase dashboard
- Rollback: re-deploy previous version
- **Done:** User sees deployment status and can access their live app

**Phase 6 gate:** User says "build me a landing page with email signup" → agent swarm builds it → deploys to Vercel + Supabase → user gets live URL.

---

## Phase 7: Admin Panel & Platform Polish (Weeks 11–13)

**Goal:** Full admin control, production-ready polish.

### P7-1: Admin auth
- Separate admin login (not tenant auth)
- MFA required
- Role: platform_admin (full access)
- **Done:** Admin can log in securely

### P7-2: User management
- List all tenants: search, filter by status/signup date/usage
- Actions: suspend, unsuspend, delete, grant credits, impersonate (read-only)
- Tenant detail: usage history, connected channels, container health
- **Done:** Admin can manage any tenant

### P7-3: RBAC / feature policy
- Feature flags per tenant: swarm, terminal, channels, deploy, specific Hands
- Global defaults (all features on for new signups)
- Override per tenant
- **Done:** Admin can toggle features for any user

### P7-4: Model & margin config
- Table: all supported models with provider cost, markup %, enabled/disabled
- Edit markup in UI, changes apply immediately
- Add new models without code deploy (config-driven)
- **Done:** Admin adjusts margins, reflected in next user request

### P7-5: Billing admin
- Revenue dashboard: daily/weekly/monthly, by model
- Margin analysis: cost vs revenue per model
- Per-tenant: spending history, credit grants, refunds
- Cost alerts: flag tenants with unusual usage spikes
- **Done:** Full financial visibility

### P7-6: Infra monitoring
- Container health: running/stopped/unhealthy per tenant
- Resource usage: CPU, RAM, disk per container
- Alerts: container crash, high resource usage, provisioning failures
- Scaling indicators: when to add nodes
- **Done:** Admin sees platform health at a glance

**Phase 7 gate:** Platform admin has full control over users, features, billing, models, and infrastructure.

---

## Phase 8: Launch (Weeks 13–14)

**Goal:** Live, public, accepting signups.

### P8-1: Security hardening
- Container isolation audit: network policies, seccomp, rootless
- Auth pen test: OAuth flows, JWT handling, session management
- LLM proxy: rate limiting, input validation, cost caps
- Data: encryption at rest, TLS everywhere
- **Done:** Security checklist passed

### P8-2: Load testing
- Simulate: 50 concurrent tenants, mixed workloads
- Measure: container startup time, LLM proxy latency, WebSocket stability
- Identify bottlenecks, set scaling thresholds
- **Done:** Platform handles target load without degradation

### P8-3: Documentation
- User docs: getting started, connecting channels, using Hands, terminal, deploy
- Admin docs: setup, configuration, model management, troubleshooting
- API docs: for power users / programmatic access
- **Done:** Docs site live (e.g., docs.agentsquads.ai)

### P8-4: Landing page
- Marketing site: hero, features, pricing calculator, demo video
- Open signup form (email + OAuth)
- SEO basics: meta tags, sitemap, structured data
- **Done:** agentsquads.ai live and indexed

### P8-5: Launch
- DNS cutover
- Monitoring dashboards active
- On-call alerts configured
- Announce: X/Twitter, LinkedIn, relevant communities
- **Done:** Public launch 🚀

---

## Post-Launch Backlog (Unscheduled)

These are real features, not aspirational — schedule them based on user feedback.

| ID | Feature | Notes |
|----|---------|-------|
| PL-1 | Per-tenant Telegram bots | Each user gets their own bot (BotFather automation) |
| PL-2 | Native mobile apps | iOS + Android (React Native or Flutter) |
| PL-3 | Skills marketplace | Users browse/install community Hands |
| PL-4 | Team tenants | Multiple users per tenant, shared agents |
| PL-5 | K8s migration | Replace Docker Compose with K8s orchestration |
| PL-6 | BYO API keys | Power users bring own LLM keys for lower cost |
| PL-7 | Webhooks / API | Programmatic access to agent capabilities |
| PL-8 | White-label | Resellers can brand AgentSquads as their own |
| PL-9 | Agent-to-agent communication | Tenants' agents can collaborate (opt-in) |
| PL-10 | Voice interface | Voice messages in Telegram/WhatsApp trigger agent |

---

## Timeline Summary

| Phase | Weeks | Gate |
|-------|-------|------|
| 1. Foundation | 1–3 | Signup → container → webchat → tokens metered |
| 2. Billing | 3–4 | Free credits → usage → pause → top-up → resume |
| 3. Channels | 4–6 | Telegram + WhatsApp + webchat synced |
| 4. Workflows | 6–8 | Guided Hand catalog + freeform chat |
| 5. Swarm + Terminal | 8–10 | Coordinator + sub-agents + web terminal |
| 6. Build & Deploy | 10–11 | Vercel/Supabase deploy pipeline |
| 7. Admin & Polish | 11–13 | Full admin panel + production hardening |
| 8. Launch | 13–14 | Public launch |

**Total: ~14 weeks to public launch.**

---

*Generated: 2026-02-27 | Author: Navi | Status: Draft — awaiting Mike's review*
