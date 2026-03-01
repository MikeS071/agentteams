# AgentSquads

AgentSquads is a multi-agent workspace with chat-first workflows, contextual side panels, and swarm monitoring.

## Features
- Agent-first chat workspace with mode-specific layouts.
- Six active agents for core workflows.
- Split UI per mode (`ChatPanel` + contextual `SidePanel`).
- Swarm monitoring in both compact (chat) and full (Swarm tab) views.
- Integrated usage, billing, onboarding, and deploy flows.

## Current Agents (6)
1. General Chat
2. Research Assistant
3. Coder
4. Intelligence Collector
5. Social Manager
6. Clip Creator

## UI Architecture
```text
DashboardLayout
└── ChatPage
    ├── AgentModeSelector
    └── AgentModeLayout
        ├── ChatPanel
        └── SidePanel (agent-specific)

SwarmStatus
├── Compact in chat
└── Full in Swarm tab
```

## Documentation
- User guide: [`docs/user-guide.md`](docs/user-guide.md)
- Technical UI architecture: [`docs/technical/ui-architecture.md`](docs/technical/ui-architecture.md)
