# UI Architecture

## Component Hierarchy (Refactored)
```text
DashboardLayout
└── ChatPage
    ├── AgentModeSelector
    └── AgentModeLayout
        ├── ChatPanel
        └── SidePanel (agent-specific)

SwarmStatus
├── Compact variant (rendered in chat)
└── Full variant (rendered in Swarm tab)
```

## Agent Registry (`lib/agents.ts`)
Agents are defined in [`apps/web/src/lib/agents.ts`](/home/openclaw/projects/agentsquads/.-worktrees/as-19/apps/web/src/lib/agents.ts).  
Each entry in `AGENTS` includes:

1. `id`, `name`, `icon`, `description`
2. `systemPrompt`
3. `welcomeMessage`
4. `buildFirstMessage(values)` initializer
5. `fields` for agent-specific inputs

The UI uses this registry to render agent selection, setup fields, and prompt bootstrapping behavior.

## Adding a New Agent
1. Add the agent definition to `AGENTS` in [`apps/web/src/lib/agents.ts`](/home/openclaw/projects/agentsquads/.-worktrees/as-19/apps/web/src/lib/agents.ts).
2. Create the side panel component for the agent mode (if the mode uses split view).
3. Wire the new mode into the `AgentModeLayout` switch so it renders the right `ChatPanel` + `SidePanel` combination.
4. Add E2E coverage for:
   - agent appears in selector
   - mode renders correctly
   - chat interaction updates side panel as expected

## Data Flow
1. User sends a chat message from `ChatPanel`.
2. Chat request is posted to `/api/chat`.
3. Streaming/response events update message state in chat.
4. Agent-specific mode state derives from conversation/tool events.
5. `SidePanel` reacts to this state and refreshes contextual content.
6. `SwarmStatus` consumes run/task state and renders compact or full variants based on location.

## API Endpoints (`/api/*`)
All app routes are under [`apps/web/src/app/api`](/home/openclaw/projects/agentsquads/.-worktrees/as-19/apps/web/src/app/api).

| Route | Method(s) | Purpose |
| --- | --- | --- |
| `/api/admin/billing` | `GET` | Admin billing analytics payload (revenue, margins, tenant breakdown, alerts). |
| `/api/admin/infra` | `GET`, `POST` | Read infra status and run admin infra actions (restart/stop). |
| `/api/admin/models` | `GET`, `POST` | List and create admin-managed model configurations. |
| `/api/admin/models/[id]` | `PUT`, `PATCH` | Update pricing/markup for one model. |
| `/api/admin/policies` | `GET`, `PATCH` | List feature policies and update tenant/global feature toggles. |
| `/api/admin/stats` | `GET` | Proxy/admin dashboard aggregate stats. |
| `/api/admin/tenants` | `GET` | List tenants (with optional search filter). |
| `/api/admin/tenants/[id]` | `GET` | Tenant detail lookup. |
| `/api/admin/tenants/[id]/credits` | `POST` | Adjust tenant credits with reason. |
| `/api/admin/tenants/[id]/resume` | `POST` | Resume suspended tenant. |
| `/api/admin/tenants/[id]/suspend` | `POST` | Suspend tenant. |
| `/api/admin/users/[id]` | `GET`, `PATCH`, `DELETE` | Admin user detail, role/suspension/credit changes, soft delete. |
| `/api/agents/config` | `GET` | Fetch all agent configs or one config by `agentId`. |
| `/api/agents/runs` | `GET` | Fetch swarm run history for current tenant. |
| `/api/auth/[...nextauth]` | `GET`, `POST` | NextAuth session/auth handlers. |
| `/api/auth/signup` | `POST` | Create user + tenant + initial credits and provisioning. |
| `/api/billing/balance` | `GET` | Return current tenant credit balance and remaining percentage. |
| `/api/billing/checkout` | `POST` | Create Stripe Checkout session for credit purchase. |
| `/api/billing/usage` | `GET` | Return billing/usage analytics and transaction timeline. |
| `/api/channels` | `GET`, `DELETE` | List channels and disconnect a channel. |
| `/api/channels/telegram` | `POST` | Connect Telegram channel for tenant. |
| `/api/channels/whatsapp` | `POST` | Connect WhatsApp channel for tenant. |
| `/api/chat` | `POST` | Send chat message to inbound router (streaming + non-stream fallback). |
| `/api/chat/conversations` | `GET` | List recent conversations for current tenant. |
| `/api/chat/history` | `GET` | Load message history for one conversation. |
| `/api/deploy/connections` | `GET`, `DELETE` | List/remove deploy provider connections. |
| `/api/deploy/run` | `POST` | Start deploy run(s) for Vercel/Supabase targets. |
| `/api/deploy/run/[id]` | `GET` | Fetch deployment run status by id. |
| `/api/deploy/supabase/authorize` | `GET` | Begin Supabase OAuth flow. |
| `/api/deploy/supabase/callback` | `GET` | Complete Supabase OAuth and store tokens. |
| `/api/deploy/tokens` | `GET`, `POST`, `DELETE` | List/connect/remove token-based deploy connections. |
| `/api/deploy/vercel/authorize` | `GET` | Begin Vercel OAuth flow. |
| `/api/deploy/vercel/callback` | `GET` | Complete Vercel OAuth and store tokens. |
| `/api/hands` | `GET` | Proxy hand list from upstream API. |
| `/api/hands/[id]` | `GET`, `PUT` | Proxy hand detail and hand config updates. |
| `/api/hands/[id]/approve/[actionId]` | `POST` | Approve pending hand action. |
| `/api/hands/[id]/history` | `GET` | Proxy hand conversation/history data. |
| `/api/hands/[id]/reject/[actionId]` | `POST` | Reject pending hand action. |
| `/api/hands/events` | `GET` | Stream hand approval/events SSE. |
| `/api/models` | `GET` | Return enabled model list for chat model picker. |
| `/api/onboarding` | `GET`, `POST` | Read/update onboarding completion flag + cookie. |
| `/api/profile` | `GET`, `PATCH`, `DELETE` | Get profile, update profile, delete account. |
| `/api/profile/password` | `POST` | Change account password. |
| `/api/profile/payment-methods` | `GET`, `PATCH`, `DELETE` | List/set default/remove Stripe payment methods. |
| `/api/profile/payment-methods/portal` | `POST` | Create Stripe Billing Portal session. |
| `/api/swarm/tasks` | `GET`, `POST` | List swarm tasks and create a new task. |
| `/api/swarm/tasks/[id]` | `GET` | Fetch one swarm task detail. |
| `/api/swarm/tasks/[id]/events` | `GET` | Stream swarm task events via SSE. |
| `/api/tenant/status` | `GET` | Return current tenant status (active/suspended/etc). |
| `/api/usage/by-model` | `GET` | Usage cost/token totals grouped by model. |
| `/api/usage/daily` | `GET` | 30-day daily usage aggregates. |
| `/api/usage/recent` | `GET` | Recent usage log entries. |
| `/api/webhooks/stripe` | `POST` | Stripe webhook: apply purchased credits and attempt tenant resume. |
