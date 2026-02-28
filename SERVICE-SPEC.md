# AgentSquads — Service Specification v1.0

> Cloud-hosted Agent OS. One agent team per user. Pay per token. Zero friction.

---

## 1. Vision

AgentSquads gives every user their own autonomous AI team — agents that chat, build, research, monitor, and deploy on their behalf. Powered by OpenFang's efficient Rust runtime, wrapped in a frictionless cloud experience with Telegram, WhatsApp, and webchat access.

**Tagline:** "Your AI team. Always on."

---

## 2. Positioning

| Product | Role |
|---------|------|
| **OpenFang** | Runtime engine (open-source, Rust, single binary) |
| **AgentSquads** | Cloud service built on OpenFang — the product users pay for |
| **ArchonHQ** | Separate product (mission control for builders) — not directly linked |
| **OpenClaw** | Open-source agent framework — AgentSquads borrows operational patterns (channels, memory, autonomy) |

AgentSquads is a **new standalone brand and service**.

---

## 3. Target Users

- **Technical users:** Developers, DevOps, indie hackers who want autonomous agents + terminal access + agent swarms
- **Non-technical users:** Founders, marketers, researchers who want AI that works for them via chat (Telegram/WhatsApp/web)
- **Common thread:** People who want more than a chatbot — they want agents that act autonomously, remember context, and deliver results

---

## 4. Core Architecture

### 4.1 Tenant Model

- **1 user = 1 tenant**
- Each tenant gets an isolated container running OpenFang
- Container includes: OpenFang binary, agent state, memory, workspace filesystem
- Containers are stateless-friendly: persistent data in mounted volumes (or object storage)

### 4.2 Runtime Stack

```
┌─────────────────────────────────────────────────┐
│                 AgentSquads Platform              │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Auth/SSO │  │ Admin    │  │ Billing /    │  │
│  │ (OAuth)  │  │ Panel    │  │ Token Meter  │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       │              │               │           │
│  ┌────┴──────────────┴───────────────┴────────┐ │
│  │           API Gateway / Router              │ │
│  │   (auth, tenant routing, rate limiting)     │ │
│  └────────────────────┬───────────────────────┘ │
│                       │                          │
│  ┌────────────────────┴───────────────────────┐ │
│  │         Channel Router                      │ │
│  │  Telegram │ WhatsApp │ Webchat (sync)      │ │
│  └────────────────────┬───────────────────────┘ │
│                       │                          │
│  ┌────────────────────┴───────────────────────┐ │
│  │         Tenant Container Orchestrator       │ │
│  │  (Docker Compose now → K8s later)          │ │
│  └────────────────────┬───────────────────────┘ │
│                       │                          │
│  ┌────────┐ ┌────────┐ ┌────────┐              │
│  │Tenant A│ │Tenant B│ │Tenant C│ ...           │
│  │OpenFang│ │OpenFang│ │OpenFang│              │
│  │+agents │ │+agents │ │+agents │              │
│  └────────┘ └────────┘ └────────┘              │
└─────────────────────────────────────────────────┘
```

### 4.3 LLM Proxy Layer

- All LLM calls routed through AgentSquads proxy
- Proxy handles: model selection, token counting, rate limiting, cost tracking
- Supported providers: OpenAI, Anthropic, Google, Mistral, open-source (via OpenRouter or direct)
- User selects preferred model in settings; all models available
- Margin applied per-token at proxy level (configurable per model in admin)

### 4.4 Infrastructure Progression

| Phase | Infra | When |
|-------|-------|------|
| **Launch** | Single VPS, Docker Compose, containers per tenant | Day 1 |
| **Growth** | Multi-node Docker Swarm or small cluster | 50–200 users |
| **Scale** | Kubernetes (containers become pods, same images) | 200+ users |

**Key constraint:** All container definitions must be K8s-compatible from day 1 (standard Dockerfiles, no Docker Compose-specific features in runtime logic). Migration = swapping orchestrator, not rewriting services.

---

## 5. Features (MVP — All Available, Admin-Gated)

### 5.1 Chat Interface

- **Webchat:** Embedded in dashboard, real-time streaming responses
- **Telegram:** Each user gets a dedicated bot (or shared bot with user routing)
- **WhatsApp:** Via WhatsApp Business API (shared number, tenant-routed)
- **Sync:** All channels share the same conversation state — message on Telegram, continue on web, same context

### 5.2 Agent Swarm

**The differentiator.**

- Coordinator agent (main) manages task decomposition and delegation
- Sub-agents spawned via tmux sessions in the tenant container
- Each sub-agent gets: own workspace directory, git worktree, task brief
- Coordinator monitors progress, reviews output, merges results
- User sees swarm activity in dashboard (which agents are running, what they're doing, status)

```
User request
    │
    ▼
┌─────────────┐
│ Coordinator  │ (main agent)
│   Agent      │
└──┬──┬──┬────┘
   │  │  │
   ▼  ▼  ▼
┌──┐┌──┐┌──┐
│A1││A2││A3│  (tmux sub-agents)
└──┘└──┘└──┘
   │  │  │
   ▼  ▼  ▼
  results merged by coordinator
```

### 5.3 Web Terminal

- Full terminal access to tenant's agent environment
- xterm.js in browser, WebSocket to container
- Users can: inspect agent workspace, run commands, manage files, debug
- Admin policy controls: enable/disable per tenant, command allowlist/denylist

### 5.4 Build & Deploy (Vercel/Supabase)

- When user wants to build an app, agent scaffolds project (Next.js + Supabase)
- Deploy target: user's own Vercel account (OAuth connection)
- Database: user's own Supabase project (OAuth connection)
- AgentSquads handles: code generation, testing, deployment commands
- AgentSquads does NOT host user apps — clean cost boundary

### 5.5 Skills / Hands — Guided Workflows

OpenFang ships with pre-built Hands (Researcher, Lead Gen, Collector, Twitter, Browser, Clip, Predictor). AgentSquads wraps each in a **guided workflow template** — a deterministic, step-by-step process that onboards the user into the Hand's capability without requiring them to know what to ask.

#### How it works

Each Hand has a **Workflow Template** — a structured flow definition:

```
┌─────────────────────────────────────────┐
│         Hand Catalog (Dashboard)         │
│                                          │
│  🔬 Research Assistant                   │
│  "Deep research on any topic"            │
│  [Start] → guided flow                   │
│                                          │
│  💻 Coder                                │
│  "Build and deploy an app"               │
│  [Start] → guided flow                   │
│                                          │
│  📊 Lead Generator                       │
│  "Find qualified prospects daily"        │
│  [Start] → guided flow                   │
│                                          │
│  🕵️ Intelligence Collector               │
│  "Monitor a target continuously"         │
│  [Start] → guided flow                   │
│                                          │
│  🐦 Social Manager                       │
│  "Manage your X/Twitter presence"        │
│  [Start] → guided flow                   │
│                                          │
│  🌐 Browser Agent                        │
│  "Automate web workflows"               │
│  [Start] → guided flow                   │
│                                          │
│  🎬 Clip Creator                         │
│  "Turn videos into viral shorts"         │
│  [Start] → guided flow                   │
│                                          │
│  🔮 Predictor                            │
│  "Calibrated forecasting engine"         │
│  [Start] → guided flow                   │
└─────────────────────────────────────────┘
```

#### Guided Flow Example: Research Assistant

```
Step 1: Topic
  "What do you want researched?"
  → User types: "AI agent frameworks comparison 2026"

Step 2: Depth
  "How deep should we go?"
  → [Quick summary (5 min)] [Standard report (30 min)] [Deep dive (2+ hours)]

Step 3: Output format
  "How do you want the results?"
  → [Markdown report] [PDF] [Slide deck outline] [Raw notes]

Step 4: Sources
  "Any specific sources to include or exclude?"
  → User types or skips

Step 5: Confirm & Launch
  "Research: AI agent frameworks comparison 2026
   Depth: Standard report
   Format: Markdown report
   Est. cost: ~$0.40 in tokens
   [Launch] [Edit]"

→ Agent activates, runs autonomously, delivers results to chat when done.
```

#### Guided Flow Example: Coder

```
Step 1: What to build
  "Describe what you want to build"
  → User types: "A landing page with email signup and Supabase backend"

Step 2: Stack
  "Preferred stack?"
  → [Next.js + Supabase (recommended)] [Other — specify]

Step 3: Deploy target
  "Where should we deploy?"
  → [My Vercel account] [Just give me the code] [Deploy later]

Step 4: Confirm & Launch
  "Building: Landing page with email signup
   Stack: Next.js + Supabase
   Deploy: Vercel (connected)
   [Launch] [Edit]"

→ Agent swarm activates: coordinator + sub-agents scaffold, build, test, deploy.
```

#### Template Definition Format

Each workflow template is a simple JSON/TOML definition:

```toml
[workflow]
hand = "researcher"
name = "Research Assistant"
description = "Deep research on any topic"
emoji = "🔬"

[[workflow.steps]]
id = "topic"
type = "text"
prompt = "What do you want researched?"
required = true

[[workflow.steps]]
id = "depth"
type = "choice"
prompt = "How deep should we go?"
options = [
  { label = "Quick summary (5 min)", value = "quick" },
  { label = "Standard report (30 min)", value = "standard" },
  { label = "Deep dive (2+ hours)", value = "deep" },
]
default = "standard"

[[workflow.steps]]
id = "format"
type = "choice"
prompt = "How do you want the results?"
options = [
  { label = "Markdown report", value = "markdown" },
  { label = "PDF", value = "pdf" },
  { label = "Slide deck outline", value = "slides" },
]

[[workflow.steps]]
id = "sources"
type = "text"
prompt = "Any specific sources to include or exclude?"
required = false

[[workflow.steps]]
id = "confirm"
type = "confirm"
show_cost_estimate = true
```

- Templates are **admin-editable** (add/remove/reorder steps, change prompts)
- Users can also skip the guided flow and just chat freeform — the template is a convenience, not a gate
- Templates work in **all channels** — webchat renders as a form/wizard, Telegram/WhatsApp as sequential messages with buttons/replies
- Admin can create **custom workflow templates** for new use cases without code changes

- Additional skills installable from marketplace (FangHub or custom registry)
- Admin controls which Hands/workflows are available globally vs per-tenant

### 5.6 Memory & Context

- Per-tenant persistent memory (file-based, same as OpenClaw's MEMORY.md pattern)
- Structured memory sidecar (memd-equivalent) per container
- Cross-session continuity — agents remember decisions, preferences, work history

---

## 6. Admin Panel

### 6.1 Platform Admin (You)

- **User management:** List, search, suspend, delete tenants
- **RBAC / Policy:** Toggle features per tenant (swarm, terminal, channels, skills, deploy)
- **Billing dashboard:** Revenue, token usage per tenant, margin analysis, cost alerts
- **Model config:** Set available models, per-model markup percentages
- **Infra monitoring:** Container health, resource usage per tenant, scaling alerts
- **Skill/Hand management:** Enable/disable globally, manage marketplace listings

### 6.2 User Dashboard

- **Chat:** Primary interface (webchat with channel sync indicators)
- **Agents:** View active agents, swarm status, task progress
- **Terminal:** Web terminal to agent environment
- **Usage:** Token consumption, cost breakdown by model, billing history
- **Settings:** Preferred model, connected channels (Telegram/WhatsApp), Vercel/Supabase connections
- **Files:** Browse agent workspace, download artifacts

---

## 7. Auth & Onboarding

### 7.1 Signup

- Email/password + OAuth (Google, GitHub, Facebook, X/Twitter, LinkedIn)
- Email verification required
- On signup: tenant container provisioned automatically (target: <30s)

### 7.2 Onboarding Flow

1. Sign up (web)
2. Container provisioned → agent ready
3. Guided first interaction: "What would you like your agent team to help with?"
4. Optional: Connect Telegram / WhatsApp (QR code or bot link)
5. Optional: Connect Vercel / Supabase for deploy capability
6. Start working

### 7.3 Auth Stack

- NextAuth.js (or Auth.js) — proven, supports all required OAuth providers (Google, GitHub, Facebook, X, LinkedIn)
- JWT sessions with refresh tokens
- API keys for programmatic access (power users)

---

## 8. Billing

### 8.1 Model

- **Free tier on signup** — every new user gets starter credits (e.g., $5) to explore without commitment
- Once credits exhausted → transition to paid (top-up or auto-charge)
- Charge per token (input + output), per model
- Platform markup on top of provider cost (e.g., provider charges $3/M input → you charge $4/M)
- Free tier includes full feature access (all Hands, swarm, terminal) — only token budget is limited

### 8.2 Metering

- LLM proxy logs every request: tenant_id, model, input_tokens, output_tokens, cost, margin
- Real-time usage dashboard for users
- Admin sees aggregate + per-tenant breakdown

### 8.3 Payment

- Stripe integration
- Pre-paid credits (buy $10/$50/$100 bundles) OR post-paid monthly invoice
- Auto-pause tenant when credits exhausted (with warning at 20%, 10%, 5%)
- Admin override: grant credits, adjust limits

### 8.4 Margin Configuration (Admin)

```
Model                  | Provider Cost (input/output per 1M) | Markup | User Price
-----------------------|-------------------------------------|--------|----------
gpt-4o                 | $2.50 / $10.00                     | 30%    | $3.25 / $13.00
claude-sonnet-4        | $3.00 / $15.00                     | 30%    | $3.90 / $19.50
claude-opus-4          | $15.00 / $75.00                    | 25%    | $18.75 / $93.75
gpt-4o-mini            | $0.15 / $0.60                      | 40%    | $0.21 / $0.84
...configurable per model in admin panel
```

---

## 9. Channel Architecture

### 9.1 Telegram

- **Option A (recommended for launch):** Single AgentSquads bot, routes messages by user ID to correct tenant container
- **Option B (later):** Per-tenant bots (requires BotFather automation)
- User links account by sending `/start` to bot with a one-time code from dashboard

### 9.2 WhatsApp

- WhatsApp Business API (Meta Cloud API)
- Single business number, route by sender phone number
- User links by scanning QR or sending a code via WhatsApp
- Requires Meta Business verification (lead time: 1–2 weeks)

### 9.3 Webchat

- Built into dashboard
- WebSocket-based, streaming responses
- Supports file upload, image display, code blocks
- Same conversation thread as Telegram/WhatsApp

### 9.4 Sync Protocol

- All channels write to same conversation store (per tenant)
- Each message tagged with source channel
- Agent responds once; response fanned out to all connected channels
- User can mute channels selectively

---

## 10. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Agent runtime** | OpenFang (Rust binary) | Efficient, single binary, MIT licensed |
| **Platform API** | Go (or Next.js API routes) | Fast, typed, matches existing skill |
| **Web dashboard** | Next.js + React | Proven, good DX, SSR for SEO pages |
| **Auth** | NextAuth.js / Auth.js | Multi-provider OAuth, battle-tested |
| **Database** | PostgreSQL | Tenant metadata, billing, usage logs |
| **Cache/Queue** | Redis | Session state, job queue, pub/sub for channel sync |
| **Billing** | Stripe | Credits, invoicing, webhooks |
| **Container orchestration** | Docker Compose → K8s | Progressive scaling |
| **LLM proxy** | Custom Go service (or extend AiPipe) | Token counting, routing, margin |
| **Terminal** | xterm.js + WebSocket | Browser terminal to container |
| **Channels** | Telegram Bot API, Meta Cloud API, WebSocket | Multi-channel sync |
| **Monitoring** | Prometheus + Grafana (or simple healthchecks) | Container + platform health |
| **DNS/CDN** | Cloudflare | SSL, DDoS protection, caching |

---

## 11. Security

- **Tenant isolation:** Each tenant runs in own container with no shared filesystem
- **Network isolation:** Containers cannot communicate with each other; only with platform API
- **LLM proxy:** All API keys stored platform-side; tenants never see provider keys
- **Auth:** JWT + refresh tokens, CSRF protection, rate limiting per tenant
- **Admin access:** Separate auth flow, MFA required
- **Data:** Encrypted at rest (volume encryption), TLS in transit
- **Secrets:** Platform secrets in `pass` or Vault; per-tenant secrets encrypted in DB

---

## 12. MVP Build Plan

### Phase 1 — Foundation (Weeks 1–3)
- [ ] Project scaffold: Next.js dashboard + Go API + PostgreSQL
- [ ] Auth: email/password + Google + GitHub OAuth
- [ ] Tenant provisioning: Docker container per signup (OpenFang binary + base config)
- [ ] LLM proxy: token counting, model routing, margin calculation
- [ ] Stripe integration: credit purchase, usage deduction, pause on zero

### Phase 2 — Chat & Channels (Weeks 3–5)
- [ ] Webchat: streaming responses, file upload, code rendering
- [ ] Telegram integration: single bot, tenant routing, account linking
- [ ] WhatsApp integration: Meta Cloud API, tenant routing
- [ ] Channel sync: shared conversation store, fan-out responses

### Phase 3 — Agent Swarm & Terminal (Weeks 5–7)
- [ ] Coordinator agent pattern: task decomposition, sub-agent spawning
- [ ] tmux sub-agent management: spawn, monitor, collect results
- [ ] Web terminal: xterm.js, WebSocket bridge to container
- [ ] Swarm dashboard: live agent status, task progress, logs

### Phase 4 — Build & Deploy (Weeks 7–9)
- [ ] Vercel OAuth: connect user's account
- [ ] Supabase OAuth: connect user's project
- [ ] Deploy pipeline: scaffold → build → test → deploy (agent-driven)
- [ ] Deployment dashboard: status, logs, rollback

### Phase 5 — Admin & Polish (Weeks 9–11)
- [ ] Admin panel: user management, RBAC, feature toggles
- [ ] Billing dashboard: usage analytics, margin reports
- [ ] Model config: per-model markup, enable/disable models
- [ ] Onboarding flow: guided first interaction, channel linking
- [ ] Skills marketplace: browse, install, admin-gate

### Phase 6 — Launch Prep (Weeks 11–12)
- [ ] Security audit: pen test, auth review, container escape testing
- [ ] Load testing: concurrent tenant containers, LLM proxy throughput
- [ ] Documentation: user docs, API docs, admin guide
- [ ] Landing page + marketing site
- [ ] Controlled beta (invite-only, 20–50 users)

---

## 13. Cost Model (Estimate)

### Fixed Costs (Platform)
| Item | Monthly Est. |
|------|-------------|
| VPS (launch: 1–2 nodes) | $50–100 |
| PostgreSQL (managed or self-hosted) | $0–20 |
| Redis | $0–15 |
| Cloudflare | $0 (free tier) |
| WhatsApp Business API | $0 + per-conversation fees |
| Stripe | 2.9% + $0.30 per transaction |
| Domain + misc | $10 |
| **Total fixed** | **~$80–150/mo** |

### Per-Tenant Costs
| Item | Est. per tenant/mo |
|------|-------------------|
| Container (idle) | ~$1–3 (256MB RAM, shared CPU) |
| Container (active) | ~$5–15 (scaled by usage) |
| Storage (1GB volume) | ~$0.10 |
| LLM tokens | Pass-through + margin (net positive) |

### Revenue per tenant
- Average user spending $20–50/mo on tokens → $6–15/mo margin at 30%
- Container cost covered at ~$10–20/mo spend
- **Break-even: ~$30/mo token spend per active user**

---

## 14. Differentiators

1. **Agent Swarm** — Not one agent, a coordinated team. Visible in dashboard. No other hosted service does this.
2. **True autonomy** — Agents work on schedules, not just when you chat. Background tasks, monitoring, lead gen.
3. **All channels in sync** — Telegram, WhatsApp, web. Same conversation, same context. Switch freely.
4. **Web terminal** — Power users get shell access to their agent's environment. Transparency, not a black box.
5. **Build & deploy** — Agents don't just chat, they ship code to Vercel/Supabase. End-to-end.
6. **Pay per use** — No subscription trap. Use more, pay more. Use nothing, pay nothing.

---

## 15. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| OpenFang v0.1 instability | Pin to specific commit; maintain fork with patches; contribute upstream |
| Container cost at scale | Implement sleep/wake for inactive tenants; set idle timeout |
| WhatsApp Business approval delay | Launch with Telegram + webchat first; WhatsApp as fast-follow |
| LLM provider rate limits | Multi-provider fallback; per-tenant rate limiting; queue bursts |
| Tenant container escape | Network isolation, seccomp profiles, rootless containers, regular audits |
| Token markup competition (race to bottom) | Differentiate on swarm + autonomy, not price; price is convenience premium |

---

## 16. Open Questions

1. **Domain:** `agentsquads.ai` (pending availability check)
2. **Beta strategy:** Open signup — no waitlist, no invite codes
3. **Free credit amount:** 1M tokens or $10, whichever is greater
4. **Mobile app:** Responsive web for now; native iOS/Android later
5. **OpenFang fork:** Private fork — full control, cherry-pick upstream updates as needed

---

*Generated: 2026-02-27 | Author: Navi | Status: Draft — awaiting Mike's review*
