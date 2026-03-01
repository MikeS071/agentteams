export type AgentSummary = {
  id: string;
  name: string;
  description: string;
  status: string;
  model: string;
  enabled: boolean;
  totalConversations: number;
  tokensToday: number;
};

export type ToolUsagePoint = {
  tool: string;
  success: number;
  failure: number;
};

export type TokenUsagePoint = {
  date: string;
  tokens: number;
};

export type ConversationMessage = {
  role: string;
  content: string;
  createdAt?: string;
};

export type AgentConversation = {
  id: string;
  title: string;
  createdAt?: string;
  status: string;
  tokenCount: number;
  messages: ConversationMessage[];
};

export type AgentDetail = AgentSummary & {
  systemPrompt: string;
  enabledTools: string[];
  availableTools: string[];
  toolUsage: ToolUsagePoint[];
  tokenUsageDaily: TokenUsagePoint[];
};

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readBoolean(value: unknown, fallback = true): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function pickFirst(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }
  return undefined;
}

function normalizeStatus(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) {
    return "unknown";
  }
  return value;
}

function normalizeToolName(raw: unknown): string {
  const str = readString(raw).trim();
  return str || "unknown";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => readString(entry).trim())
    .filter((entry) => entry.length > 0);
}

function normalizeToolUsage(value: unknown): ToolUsagePoint[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        const item = toObject(entry);
        const success = readNumber(pickFirst(item, ["success", "success_count", "successful", "ok"]), 0);
        const failure = readNumber(pickFirst(item, ["failure", "failure_count", "failed", "error"]), 0);
        const tool = normalizeToolName(pickFirst(item, ["tool", "name", "tool_name", "id"]));
        return { tool, success, failure };
      })
      .filter((entry) => entry.success > 0 || entry.failure > 0);
  }

  const obj = toObject(value);
  return Object.entries(obj)
    .map(([key, entry]) => {
      const item = toObject(entry);
      return {
        tool: key,
        success: readNumber(pickFirst(item, ["success", "success_count", "successful", "ok"]), 0),
        failure: readNumber(pickFirst(item, ["failure", "failure_count", "failed", "error"]), 0),
      };
    })
    .filter((entry) => entry.success > 0 || entry.failure > 0);
}

function normalizeTokenDaily(value: unknown): TokenUsagePoint[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const item = toObject(entry);
      return {
        date: readString(pickFirst(item, ["date", "day", "timestamp", "label"]), "-"),
        tokens: readNumber(pickFirst(item, ["tokens", "total", "total_tokens", "token_count"]), 0),
      };
    })
    .filter((entry) => entry.tokens >= 0);
}

function normalizeMessages(value: unknown): ConversationMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const item = toObject(entry);
      return {
        role: readString(pickFirst(item, ["role", "sender"]), "assistant"),
        content: readString(pickFirst(item, ["content", "text", "message"]), ""),
        createdAt: readString(pickFirst(item, ["created_at", "createdAt", "timestamp"]), "") || undefined,
      };
    })
    .filter((entry) => entry.content.length > 0);
}

function tokensFromMessages(messages: ConversationMessage[]): number {
  return messages.reduce((total, message) => total + message.content.length / 4, 0);
}

export function normalizeAgentsPayload(payload: unknown): AgentSummary[] {
  const root = toObject(payload);
  const listRaw = pickFirst(root, ["ai_agents", "agents", "items", "data"]);
  const list = Array.isArray(listRaw) ? listRaw : [];

  return list.map((entry, index) => {
    const item = toObject(entry);
    return {
      id: readString(pickFirst(item, ["id", "agent_id", "hand_id"]), `agent-${index + 1}`),
      name: readString(pickFirst(item, ["name", "title", "agent_name", "hand_name"]), `AI Agent ${index + 1}`),
      description: readString(pickFirst(item, ["description", "summary"]), ""),
      status: normalizeStatus(readString(pickFirst(item, ["status", "state"]), "unknown")),
      model: readString(pickFirst(item, ["model", "model_name"]), "Unknown model"),
      enabled: readBoolean(pickFirst(item, ["enabled", "is_enabled", "active"]), true),
      totalConversations: readNumber(pickFirst(item, ["total_conversations", "conversation_count", "conversations"]), 0),
      tokensToday: readNumber(pickFirst(item, ["tokens_today", "today_tokens", "token_count_today"]), 0),
    };
  });
}

export function normalizeAgentDetailPayload(payload: unknown): AgentDetail {
  const item = toObject(payload);

  return {
    id: readString(pickFirst(item, ["id", "agent_id", "hand_id"]), ""),
    name: readString(pickFirst(item, ["name", "title", "agent_name", "hand_name"]), "AI Agent"),
    description: readString(pickFirst(item, ["description", "summary"]), ""),
    status: normalizeStatus(readString(pickFirst(item, ["status", "state"]), "unknown")),
    model: readString(pickFirst(item, ["model", "model_name"]), "Unknown model"),
    enabled: readBoolean(pickFirst(item, ["enabled", "is_enabled", "active"]), true),
    totalConversations: readNumber(pickFirst(item, ["total_conversations", "conversation_count", "conversations"]), 0),
    tokensToday: readNumber(pickFirst(item, ["tokens_today", "today_tokens", "token_count_today"]), 0),
    systemPrompt: readString(pickFirst(item, ["system_prompt", "systemPrompt", "prompt"]), ""),
    enabledTools: normalizeStringArray(pickFirst(item, ["enabled_tools", "enabledTools", "tools"])),
    availableTools: normalizeStringArray(pickFirst(item, ["available_tools", "availableTools", "all_tools"])),
    toolUsage: normalizeToolUsage(pickFirst(item, ["tool_usage", "tools_usage", "toolUsage"])),
    tokenUsageDaily: normalizeTokenDaily(pickFirst(item, ["token_usage_daily", "daily_tokens", "tokenUsageDaily"])),
  };
}

export function normalizeAgentHistoryPayload(payload: unknown): AgentConversation[] {
  const root = toObject(payload);
  const listRaw = pickFirst(root, ["history", "conversations", "items", "data"]);
  const list = Array.isArray(listRaw) ? listRaw : [];

  return list.map((entry, index) => {
    const item = toObject(entry);
    const messages = normalizeMessages(pickFirst(item, ["messages", "entries"]));
    const tokenCountRaw = pickFirst(item, ["token_count", "tokens", "total_tokens"]);

    return {
      id: readString(pickFirst(item, ["id", "conversation_id"]), `conv-${index + 1}`),
      title: readString(pickFirst(item, ["title", "preview", "name"]), `Conversation ${index + 1}`),
      createdAt: readString(pickFirst(item, ["created_at", "createdAt", "timestamp"]), "") || undefined,
      status: normalizeStatus(readString(pickFirst(item, ["status", "state"]), "completed")),
      tokenCount:
        tokenCountRaw === undefined || tokenCountRaw === null
          ? Math.round(tokensFromMessages(messages))
          : readNumber(tokenCountRaw, 0),
      messages,
    };
  });
}

export function buildToolUsageFromHistory(history: AgentConversation[]): ToolUsagePoint[] {
  const counters = new Map<string, { success: number; failure: number }>();

  for (const conversation of history) {
    const conversationRecord = toObject(conversation as unknown);
    const rawTools = pickFirst(conversationRecord, ["tools", "tool_calls", "toolCalls"]);
    if (!Array.isArray(rawTools)) {
      continue;
    }

    for (const entry of rawTools) {
      const item = toObject(entry);
      const tool = normalizeToolName(pickFirst(item, ["tool", "name", "tool_name"]));
      const success = readBoolean(pickFirst(item, ["success", "ok", "status"]), true);
      const current = counters.get(tool) ?? { success: 0, failure: 0 };
      if (success) {
        current.success += 1;
      } else {
        current.failure += 1;
      }
      counters.set(tool, current);
    }
  }

  return Array.from(counters.entries()).map(([tool, value]) => ({ tool, ...value }));
}
