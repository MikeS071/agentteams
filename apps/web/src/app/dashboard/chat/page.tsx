"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AgentGrid from "@/components/AgentGrid";
import AgentModeLayout from "@/components/AgentModeLayout";
import AgentModeSelector from "@/components/AgentModeSelector";
import AgentSetup, { type AgentWizardConfig } from "@/components/AgentSetup";
import ChatInput from "@/components/ChatInput";
import ChatMessage from "@/components/ChatMessage";
import { AGENTS, getAgent, type AgentType } from "@/lib/agents";

type Role = "user" | "assistant" | "system";

type ToolStatus = "running" | "success" | "error";

type ToolExecution = {
  id: string;
  name: string;
  status: ToolStatus;
  output?: string;
};

type Message = {
  id?: string;
  role: Role;
  content: string;
  createdAt?: string;
  suggestions?: string[];
  tools?: ToolExecution[];
};

type Conversation = { id: string; preview: string; createdAt: string; lastActivityAt: string };
type AgentConfigMap = Record<string, AgentWizardConfig>;
type Model = { id: string; name: string; provider: string };

type HandConfigResponse = {
  configs?: Record<string, { id: string; systemPrompt: string; modelPreference: string; enabledTools: string[] }>;
};

const AGENT_ORDER = [
  "research",
  "coder",
  "intel",
  "social",
  "clip",
  "chat",
] as const;

const SELECTED_AGENT_KEY = "openfang:selected-agent";
const AGENT_CONFIGS_KEY = "openfang:agent-configs-v1";
const MODEL_SELECTIONS_KEY = "openfang:model-selections-v1";
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_TOOLS = ["web_search", "web_fetch"];
const SPLIT_MODE_AGENTS = new Set(["research", "intel", "social", "clip"]);

const MODE_PANEL_META: Record<string, { title: string; subtitle: string }> = {
  research: { title: "Research Workspace", subtitle: "Source planning and evidence board" },
  intel: { title: "Intel Workspace", subtitle: "Signals, timelines, and watchlist" },
  social: { title: "Social Workspace", subtitle: "Content drafts and campaign calendar" },
  clip: { title: "Clip Workspace", subtitle: "Clip queue and publishing context" },
};

function LoadingDots() {
  return (
    <div className="inline-flex items-center gap-1">
      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.2s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.1s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
    </div>
  );
}

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#2f8f5b] border-t-transparent" />;
}

function normalizeConfig(agent: AgentType, value?: Partial<AgentWizardConfig>): AgentWizardConfig {
  const enabledTools = Array.isArray(value?.enabledTools)
    ? value.enabledTools.filter((tool) => typeof tool === "string" && tool.length > 0)
    : DEFAULT_TOOLS;

  return {
    systemPrompt: value?.systemPrompt?.trim() || agent.systemPrompt,
    modelPreference: value?.modelPreference?.trim() || DEFAULT_MODEL,
    enabledTools: enabledTools.length > 0 ? Array.from(new Set(enabledTools)) : DEFAULT_TOOLS,
  };
}

function defaultConfigs() {
  const base: AgentConfigMap = {};
  for (const agent of AGENTS) {
    base[agent.id] = normalizeConfig(agent);
  }
  return base;
}

function sanitizeSuggestion(value: string) {
  return value
    .replace(/^\s*[-*\d.)\s]+/, "")
    .replace(/^\s*(follow[- ]?up\s*(menu)?\s*:?)\s*/i, "")
    .trim();
}

function parseFollowUpsFromText(content: string): string[] {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed = lines
    .filter((line) => /^\d+[.):-]\s+/.test(line) || /^[-*]\s+/.test(line))
    .map(sanitizeSuggestion)
    .filter((line) => line.length >= 8 && line.length <= 180);

  return Array.from(new Set(parsed)).slice(0, 3);
}

function generateFollowUps(content: string): string[] {
  const plain = content.replace(/[`*_>#\[\]()]/g, " ");
  const words = plain
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9-]/g, ""))
    .filter((word) => word.length >= 5)
    .filter((word) => !["about", "there", "their", "would", "could", "should", "which", "while", "where"].includes(word));

  const topic = words[0] || "this";

  return [
    `Go deeper on ${topic} with concrete examples.`,
    `Compare options or alternatives for ${topic}.`,
    "Turn this into a step-by-step action plan.",
  ];
}

function ensureSuggestions(existing: string[] | undefined, content: string): string[] {
  if (existing && existing.length > 0) {
    return existing.slice(0, 3);
  }

  const fromText = parseFollowUpsFromText(content);
  if (fromText.length > 0) {
    return fromText;
  }

  return generateFollowUps(content);
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function extractObject(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

function extractTextValue(data: Record<string, unknown>): string {
  const candidates = ["delta", "token", "text", "content", "message"];
  for (const key of candidates) {
    const value = data[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

function extractConversationId(data: Record<string, unknown>): string | null {
  const conversationId = data.conversationId;
  if (typeof conversationId === "string" && conversationId.trim()) {
    return conversationId.trim();
  }

  const snakeConversationId = data.conversation_id;
  if (typeof snakeConversationId === "string" && snakeConversationId.trim()) {
    return snakeConversationId.trim();
  }

  return null;
}

function extractSuggestionList(data: Record<string, unknown>): string[] {
  const direct = data.suggestions;
  if (Array.isArray(direct)) {
    return direct
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  const metadataObj = extractObject(data.metadata);
  const nested = metadataObj?.suggestions;
  if (Array.isArray(nested)) {
    return nested
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  return [];
}

function parseToolName(data: Record<string, unknown>): string {
  const candidates = ["tool", "toolName", "tool_name", "name"];
  for (const key of candidates) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "tool";
}

function parseToolId(data: Record<string, unknown>, fallbackName: string): string {
  const id = data.toolCallId ?? data.tool_call_id ?? data.id;
  if (typeof id === "string" && id.trim()) {
    return id.trim();
  }
  return `${fallbackName}-${Date.now()}`;
}

function parseToolOutput(data: Record<string, unknown>): string {
  const candidates = ["output", "result", "content", "text", "message", "error"];
  for (const key of candidates) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

export default function ChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const endRef = useRef<HTMLDivElement | null>(null);

  const [selectedAgent, setSelectedAgent] = useState<AgentType>(getAgent("chat"));
  const [activeMode, setActiveMode] = useState<string | null>(null);
  const [wizardAgent, setWizardAgent] = useState<AgentType | null>(null);
  const [agentConfigs, setAgentConfigs] = useState<AgentConfigMap>(defaultConfigs);
  const [modelSelections, setModelSelections] = useState<Record<string, string>>({});
  const [models, setModels] = useState<Model[]>([]);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [replyLoading, setReplyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeConversationId = useMemo(() => searchParams?.get("conversationId") || undefined, [searchParams]);

  const orderedAgents = useMemo(
    () => AGENT_ORDER.map((id) => AGENTS.find((agent) => agent.id === id)).filter((agent): agent is AgentType => Boolean(agent)),
    []
  );

  const currentAgentConfig = agentConfigs[selectedAgent.id] ?? normalizeConfig(selectedAgent);

  const activeModelId = useMemo(() => {
    const selected = modelSelections[selectedAgent.id];
    if (selected && models.some((model) => model.id === selected)) {
      return selected;
    }

    if (currentAgentConfig.modelPreference && models.some((model) => model.id === currentAgentConfig.modelPreference)) {
      return currentAgentConfig.modelPreference;
    }

    return models[0]?.id ?? currentAgentConfig.modelPreference;
  }, [currentAgentConfig.modelPreference, modelSelections, models, selectedAgent.id]);

  const activeModelLabel = useMemo(() => {
    const found = models.find((model) => model.id === activeModelId);
    if (!found) {
      return activeModelId || currentAgentConfig.modelPreference;
    }
    return `${found.provider} · ${found.name}`;
  }, [activeModelId, currentAgentConfig.modelPreference, models]);

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/chat/conversations", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed");
    const data = (await res.json()) as { conversations: Conversation[] };
    setConversations(data.conversations || []);
  }, []);

  const loadHistory = useCallback(async (id: string) => {
    setHistoryLoading(true);
    setError(null);
    setWizardAgent(null);
    try {
      const res = await fetch(`/api/chat/history?conversationId=${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as { messages: Message[] };
      setMessages(data.messages || []);
      setConversationId(id);
      setSidebarOpen(false);
    } catch {
      setError("Could not load this conversation.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations().catch(() => {});
  }, [loadConversations]);

  useEffect(() => {
    if (activeConversationId) {
      void loadHistory(activeConversationId);
    }
  }, [activeConversationId, loadHistory]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, replyLoading]);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/agents/config", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to fetch configs");
        }
        return res.json() as Promise<HandConfigResponse>;
      })
      .then((data) => {
        if (cancelled || !data.configs) {
          return;
        }
        setAgentConfigs((prev) => {
          const next: AgentConfigMap = { ...prev };
          for (const agent of AGENTS) {
            const remote = data.configs?.[agent.id];
            if (remote) {
              next[agent.id] = normalizeConfig(agent, remote);
            }
          }
          return next;
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/models", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to fetch models");
        }
        return res.json() as Promise<{ models?: Model[] }>;
      })
      .then((data) => {
        if (cancelled) {
          return;
        }
        setModels(data.models || []);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const savedAgent = window.localStorage.getItem(SELECTED_AGENT_KEY);
    if (savedAgent) {
      setSelectedAgent(getAgent(savedAgent));
    }

    const savedConfigs = window.localStorage.getItem(AGENT_CONFIGS_KEY);
    if (savedConfigs) {
      try {
        const parsed = JSON.parse(savedConfigs) as Record<string, Partial<AgentWizardConfig>>;
        setAgentConfigs((prev) => {
          const next: AgentConfigMap = { ...prev };
          for (const agent of AGENTS) {
            if (parsed[agent.id]) {
              next[agent.id] = normalizeConfig(agent, parsed[agent.id]);
            }
          }
          return next;
        });
      } catch {
        // Ignore invalid localStorage payload.
      }
    }

    const savedModels = window.localStorage.getItem(MODEL_SELECTIONS_KEY);
    if (savedModels) {
      try {
        const parsed = JSON.parse(savedModels) as Record<string, string>;
        setModelSelections(parsed);
      } catch {
        // Ignore invalid localStorage payload.
      }
    }

    setStorageLoaded(true);
  }, []);

  useEffect(() => {
    if (!storageLoaded) {
      return;
    }
    window.localStorage.setItem(SELECTED_AGENT_KEY, selectedAgent.id);
  }, [selectedAgent.id, storageLoaded]);

  useEffect(() => {
    if (!storageLoaded) {
      return;
    }
    window.localStorage.setItem(AGENT_CONFIGS_KEY, JSON.stringify(agentConfigs));
  }, [agentConfigs, storageLoaded]);

  useEffect(() => {
    if (!storageLoaded) {
      return;
    }
    window.localStorage.setItem(MODEL_SELECTIONS_KEY, JSON.stringify(modelSelections));
  }, [modelSelections, storageLoaded]);

  useEffect(() => {
    if (!models.length) {
      return;
    }

    const existing = modelSelections[selectedAgent.id];
    if (existing && models.some((model) => model.id === existing)) {
      return;
    }

    const fallback =
      (currentAgentConfig.modelPreference && models.find((model) => model.id === currentAgentConfig.modelPreference)?.id) ||
      models[0]?.id;

    if (!fallback) {
      return;
    }

    setModelSelections((prev) => {
      if (prev[selectedAgent.id] === fallback) {
        return prev;
      }
      return { ...prev, [selectedAgent.id]: fallback };
    });
  }, [currentAgentConfig.modelPreference, modelSelections, models, selectedAgent.id]);

  const updateAssistantMessage = useCallback(
    (assistantId: string, updater: (message: Message) => Message) => {
      setMessages((prev) => prev.map((message) => (message.id === assistantId ? updater(message) : message)));
    },
    []
  );

  const handleSend = useCallback(
    async (text: string) => {
      const messageText = text.trim();
      if (!messageText) {
        return;
      }

      const userMsg: Message = { role: "user", content: messageText };
      const assistantId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `assistant-${Date.now()}`;

      const assistantStub: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        tools: [],
      };

      setMessages((prev) => [...prev, userMsg, assistantStub]);
      setReplyLoading(true);
      setError(null);

      const selectedConfig = agentConfigs[selectedAgent.id] ?? normalizeConfig(selectedAgent);
      const resolvedModel = activeModelId || selectedConfig.modelPreference || undefined;
      let resolvedConversationId = conversationId;
      let streamedText = "";
      let streamedSuggestions: string[] = [];

      const upsertTool = (nextTool: ToolExecution) => {
        updateAssistantMessage(assistantId, (message) => {
          const currentTools = message.tools ?? [];
          const existingIndex = currentTools.findIndex((tool) => tool.id === nextTool.id);

          if (existingIndex === -1) {
            return { ...message, tools: [...currentTools, nextTool] };
          }

          const updated = [...currentTools];
          updated[existingIndex] = {
            ...updated[existingIndex],
            ...nextTool,
          };
          return { ...message, tools: updated };
        });
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            message: messageText,
            model: resolvedModel,
            agentId: selectedAgent.id,
            systemPrompt: selectedConfig.systemPrompt,
            enabledTools: selectedConfig.enabledTools,
            stream: true,
          }),
        });

        if (!res.ok) {
          let details = "Failed";
          try {
            const json = (await res.json()) as { error?: string };
            details = json.error || details;
          } catch {
            // No-op.
          }
          throw new Error(details);
        }

        const contentType = (res.headers.get("content-type") || "").toLowerCase();

        if (contentType.includes("text/event-stream") && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          const processEvent = (eventNameRaw: string, dataRaw: string) => {
            const eventName = eventNameRaw.toLowerCase();
            const parsed = safeJsonParse(dataRaw);
            const objectData = extractObject(parsed);

            const effectiveType =
              (typeof objectData?.type === "string" && objectData.type.toLowerCase()) ||
              (typeof objectData?.event === "string" && objectData.event.toLowerCase()) ||
              eventName ||
              "message";

            const isTokenEvent = ["token", "delta", "content_delta", "message_delta", "text_delta", "chunk"].includes(effectiveType);
            if (isTokenEvent) {
              const tokenText = objectData ? extractTextValue(objectData) : dataRaw;
              if (tokenText) {
                streamedText += tokenText;
                updateAssistantMessage(assistantId, (message) => ({ ...message, content: streamedText }));
              }
              return;
            }

            const isToolStartEvent = ["tool_executing", "tool_start", "tool_started"].includes(effectiveType);
            if (isToolStartEvent && objectData) {
              const toolName = parseToolName(objectData);
              const toolId = parseToolId(objectData, toolName);
              upsertTool({ id: toolId, name: toolName, status: "running" });
              return;
            }

            const isToolResultEvent = ["tool_result", "tool_completed", "tool_end"].includes(effectiveType);
            if (isToolResultEvent && objectData) {
              const toolName = parseToolName(objectData);
              const toolId = parseToolId(objectData, toolName);
              upsertTool({
                id: toolId,
                name: toolName,
                status: "success",
                output: parseToolOutput(objectData),
              });
              return;
            }

            const isToolErrorEvent = ["tool_error", "tool_failed"].includes(effectiveType);
            if (isToolErrorEvent && objectData) {
              const toolName = parseToolName(objectData);
              const toolId = parseToolId(objectData, toolName);
              upsertTool({
                id: toolId,
                name: toolName,
                status: "error",
                output: parseToolOutput(objectData),
              });
              return;
            }

            if (objectData) {
              const nextConversationId = extractConversationId(objectData);
              if (nextConversationId) {
                resolvedConversationId = nextConversationId;
              }

              const nextSuggestions = extractSuggestionList(objectData);
              if (nextSuggestions.length > 0) {
                streamedSuggestions = nextSuggestions;
              }

              const textValue = extractTextValue(objectData);
              if (["assistant_message", "message", "final", "hand_completed", "done", "complete"].includes(effectiveType) && textValue) {
                streamedText = textValue;
                updateAssistantMessage(assistantId, (message) => ({ ...message, content: streamedText }));
              }
            }
          };

          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });

            while (true) {
              const boundary = buffer.indexOf("\n\n");
              if (boundary === -1) {
                break;
              }

              const rawEvent = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);

              const lines = rawEvent.split("\n");
              let eventName = "message";
              const dataParts: string[] = [];

              for (const line of lines) {
                if (line.startsWith("event:")) {
                  eventName = line.slice(6).trim() || "message";
                }
                if (line.startsWith("data:")) {
                  dataParts.push(line.slice(5).trim());
                }
              }

              if (dataParts.length > 0) {
                processEvent(eventName, dataParts.join("\n"));
              }
            }
          }
        } else {
          const data = (await res.json()) as {
            error?: string;
            conversationId?: string;
            message?: Message;
            suggestions?: string[];
          };

          if (!data.message?.content) {
            throw new Error(data.error || "Failed");
          }

          streamedText = data.message.content;
          streamedSuggestions = (Array.isArray(data.suggestions) ? data.suggestions : []).slice(0, 3);
          resolvedConversationId = data.conversationId || resolvedConversationId;

          updateAssistantMessage(assistantId, (message) => ({
            ...message,
            content: streamedText,
          }));
        }

        const finalSuggestions = ensureSuggestions(streamedSuggestions, streamedText);
        updateAssistantMessage(assistantId, (message) => ({
          ...message,
          content: streamedText || message.content,
          suggestions: finalSuggestions,
        }));

        if (resolvedConversationId && conversationId !== resolvedConversationId) {
          setConversationId(resolvedConversationId);
          router.replace(`/dashboard/chat?conversationId=${resolvedConversationId}`);
        }

        await loadConversations();
      } catch {
        updateAssistantMessage(assistantId, () => ({
          id: assistantId,
          role: "assistant",
          content: "I couldn't process that. Please try again.",
          suggestions: [
            "Retry with a shorter prompt.",
            "Ask for a concise answer first, then details.",
            "Try a different model for this hand.",
          ],
          tools: [],
        }));
      } finally {
        setReplyLoading(false);
      }
    },
    [activeModelId, agentConfigs, conversationId, loadConversations, router, selectedAgent, updateAssistantMessage]
  );

  function handleAgentModeEnter(agent: AgentType) {
    setSelectedAgent(agent);
    setActiveMode(agent.id);
    setSidebarOpen(false);
    setWizardAgent(null);
  }

  function handleAgentModeSwitch(agent: AgentType) {
    setSelectedAgent(agent);
    setActiveMode(agent.id);
    setWizardAgent(null);
  }

  function handleExitAgentMode() {
    setActiveMode(null);
    setWizardAgent(null);
  }

  function handleAgentConfigOpen(agent: AgentType) {
    setSelectedAgent(agent);
    setWizardAgent(agent);
  }

  function handleAgentConfigSave(config: AgentWizardConfig) {
    if (!wizardAgent) {
      return;
    }
    const agent = wizardAgent;
    setAgentConfigs((prev) => ({
      ...prev,
      [agent.id]: normalizeConfig(agent, config),
    }));
    setWizardAgent(null);
  }

  function handleNewChat() {
    setConversationId(undefined);
    setMessages([]);
    setError(null);
    setWizardAgent(null);
    router.replace("/dashboard/chat");
  }

  const hasChat = messages.length > 0 || conversationId;

  const lastAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "assistant") {
        return messages[i];
      }
    }
    return null;
  }, [messages]);

  const followUpSuggestions = useMemo(() => {
    if (!lastAssistantMessage || replyLoading) {
      return [];
    }

    return ensureSuggestions(lastAssistantMessage.suggestions, lastAssistantMessage.content);
  }, [lastAssistantMessage, replyLoading]);

  const inAgentMode = activeMode !== null;
  const showSplitLayout = inAgentMode && SPLIT_MODE_AGENTS.has(selectedAgent.id);
  const sidePanelMeta = MODE_PANEL_META[selectedAgent.id];
  const modeSidePanel = showSplitLayout && sidePanelMeta ? (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-[#1f2733] bg-[#0d131b]">
      <div className="border-b border-[#1e2835] px-4 py-3">
        <p className="text-xs uppercase tracking-[0.12em] text-gray-500">{selectedAgent.name}</p>
        <h3 className="text-sm font-semibold text-gray-100">{sidePanelMeta.title}</h3>
        <p className="text-xs text-gray-400">{sidePanelMeta.subtitle}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="space-y-3 rounded-xl border border-[#243140] bg-[#101826] p-3">
          <p className="text-xs uppercase tracking-wide text-gray-500">Agent Prompt</p>
          <p className="line-clamp-4 text-sm text-gray-200">{currentAgentConfig.systemPrompt}</p>
        </div>
        <div className="mt-3 space-y-2 rounded-xl border border-[#243140] bg-[#101826] p-3">
          <p className="text-xs uppercase tracking-wide text-gray-500">Enabled Tools</p>
          <div className="flex flex-wrap gap-2">
            {currentAgentConfig.enabledTools.length === 0 ? (
              <span className="text-xs text-gray-400">No tools configured.</span>
            ) : (
              currentAgentConfig.enabledTools.map((tool) => (
                <span
                  key={tool}
                  className="rounded-full border border-[#2f8f5b]/40 bg-[#123424] px-2 py-0.5 text-[11px] text-[#b8f7d8]"
                >
                  {tool}
                </span>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  ) : undefined;

  const chatContent = (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
          {historyLoading ? (
            <p className="text-sm text-gray-400">Loading conversation...</p>
          ) : !hasChat ? (
            <div className="flex flex-col items-center justify-center gap-4 pt-20 text-center">
              <span className="text-5xl">{selectedAgent.icon}</span>
              <h2 className="text-xl font-bold text-white">{selectedAgent.name}</h2>
              <p className="max-w-md text-sm text-gray-400">{selectedAgent.description}</p>
              <p className="text-xs text-gray-600">
                {inAgentMode
                  ? "Switch agents from the top strip, or return to the full grid using Back to agents."
                  : `Pick any of the ${orderedAgents.length} agents from the grid and start chatting, or use Config to tune this Hand.`}
              </p>
            </div>
          ) : (
            messages.map((message, index) => (
              <div key={message.id || `${message.role}-${index}-${message.content.slice(0, 20)}`} className="space-y-2">
                <ChatMessage role={message.role} content={message.content} />

                {message.role === "assistant" && message.tools && message.tools.length > 0 && (
                  <div className="mr-auto w-full max-w-[92%] space-y-2 sm:max-w-[80%]">
                    {message.tools.map((tool) => (
                      <details
                        key={tool.id}
                        open={tool.status === "running"}
                        className="overflow-hidden rounded-lg border border-[#24313a] bg-[#0d1217]"
                      >
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs text-gray-300">
                          <span className="inline-flex items-center gap-2">
                            {tool.status === "running" ? <Spinner /> : <span className="h-2 w-2 rounded-full bg-[#4ade80]" />}
                            <span className="font-mono">{tool.name}</span>
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                              tool.status === "running"
                                ? "bg-[#163c2a] text-[#9ff1c5]"
                                : tool.status === "error"
                                  ? "bg-[#3b1a1a] text-[#fca5a5]"
                                  : "bg-[#122736] text-[#93c5fd]"
                            }`}
                          >
                            {tool.status}
                          </span>
                        </summary>

                        {tool.output && (
                          <pre className="max-h-64 overflow-auto border-t border-[#1f2b34] bg-[#0a0e12] p-3 text-xs text-gray-200">
                            <code>{tool.output}</code>
                          </pre>
                        )}
                      </details>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}

          {replyLoading && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md border border-[#23233a] bg-[#12121a] px-4 py-3 text-sm text-gray-100">
                <LoadingDots />
              </div>
            </div>
          )}

          {followUpSuggestions.length > 0 && (
            <div className="mr-auto flex w-full max-w-[92%] flex-wrap gap-2 sm:max-w-[80%]">
              {followUpSuggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion}-${index}`}
                  type="button"
                  onClick={() => {
                    if (!replyLoading && !historyLoading) {
                      void handleSend(suggestion);
                    }
                  }}
                  disabled={replyLoading || historyLoading}
                  className="rounded-lg border border-[#2a3642] bg-[#0f141b] px-3 py-2 text-left text-xs text-gray-200 transition-colors hover:border-[#3f596f] hover:bg-[#141b24] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-[#1f1f2a] bg-[#0f0f16] px-3 py-2 sm:px-4">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-2 text-xs">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#2f8f5b]/50 bg-[#11271c] px-2.5 py-1 text-[#9ff1c5]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#4ade80]" />
            {selectedAgent.icon} {selectedAgent.name}
          </span>
          <span className="truncate rounded-full border border-[#2f2f3a] bg-[#15151d] px-2.5 py-1 font-mono text-gray-300">
            {activeModelLabel}
          </span>
        </div>
      </div>

      <ChatInput onSend={handleSend} disabled={replyLoading || historyLoading} />
    </>
  );

  return (
    <div className="relative flex h-[calc(100vh-3rem)] max-h-[calc(100vh-3rem)] min-h-0 bg-[#0a0a0b]">
      {sidebarOpen && (
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          aria-label="Close"
        />
      )}

      <aside
        className={`absolute inset-y-0 left-0 z-30 flex w-[360px] flex-col border-r border-[#1a1a1f] bg-[#0d0d12]/90 backdrop-blur-xl transition-transform md:static md:z-0 md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-[#1f1f25] p-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Conversations</h2>
          <button
            type="button"
            onClick={handleNewChat}
            className="rounded-md bg-[#2563eb] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#1d4ed8]"
          >
            + New
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          <div className="rounded-2xl border border-[#24242c] bg-[#111118] p-2">
            {conversations.length === 0 ? (
              <p className="px-2 py-3 text-xs text-gray-500">No conversations yet</p>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setSidebarOpen(false);
                    router.replace(`/dashboard/chat?conversationId=${c.id}`);
                  }}
                  className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    c.id === conversationId
                      ? "bg-[#1a1a22] text-gray-100"
                      : "text-gray-400 hover:bg-[#161620] hover:text-gray-200"
                  }`}
                >
                  <p className="truncate">{c.preview}</p>
                </button>
              ))
            )}
          </div>

          {inAgentMode ? (
            <div className="rounded-2xl border border-[#24242c] bg-[#111118] p-3">
              <p className="text-xs text-gray-400">Agent mode active. Use the top selector to switch agents.</p>
            </div>
          ) : (
            <AgentGrid
              agents={orderedAgents}
              selectedAgentId={selectedAgent.id}
              onSelect={handleAgentModeEnter}
              onConfigure={handleAgentConfigOpen}
            />
          )}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-[#1a1a1f] px-3 py-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen((open) => !open)}
              className="rounded-md border border-[#2a2a33] px-3 py-1.5 text-sm text-gray-200 md:hidden"
            >
              ☰
            </button>
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <span>{selectedAgent.icon}</span>
              <span className="font-medium text-gray-100">{selectedAgent.name}</span>
              <span className="rounded-full bg-[#173425] px-2 py-0.5 text-xs text-[#9ff1c5]">
                {inAgentMode ? "mode" : "active"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {inAgentMode && (
              <button
                type="button"
                onClick={handleExitAgentMode}
                className="rounded-md border border-[#334155] bg-[#111827] px-3 py-1.5 text-xs font-medium text-gray-200 hover:border-[#475569] hover:text-white"
              >
                Back to agents
              </button>
            )}
            <div className="flex items-center gap-2 rounded-xl border border-[#26262f] bg-[#101217] px-2 py-1.5">
              <span className="hidden items-center gap-1 text-[11px] text-gray-500 sm:inline-flex">
                <span className="h-2 w-2 rounded-full bg-[#ff5f57]" />
                <span className="h-2 w-2 rounded-full bg-[#febc2e]" />
                <span className="h-2 w-2 rounded-full bg-[#28c840]" />
              </span>
              <select
                value={activeModelId}
                onChange={(event) => {
                  const next = event.target.value;
                  setModelSelections((prev) => ({ ...prev, [selectedAgent.id]: next }));
                }}
                className="h-8 max-w-[260px] rounded-md border border-[#2c3440] bg-[#0c0f14] px-2 text-xs text-gray-200 focus:border-[#3b82f6] focus:outline-none"
                aria-label="Select model"
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.provider} · {model.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {inAgentMode && (
          <AgentModeSelector agents={orderedAgents} activeAgentId={selectedAgent.id} onSelect={handleAgentModeSwitch} />
        )}

        {wizardAgent && (
          <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
            <AgentSetup
              agent={wizardAgent}
              initialConfig={agentConfigs[wizardAgent.id] ?? normalizeConfig(wizardAgent)}
              onSave={handleAgentConfigSave}
              onBack={() => setWizardAgent(null)}
            />
          </div>
        )}

        {!wizardAgent &&
          (inAgentMode ? (
            <AgentModeLayout
              agentId={selectedAgent.id}
              chatPanel={
                <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-[#1f2733] bg-[#0d1117]">
                  {chatContent}
                </div>
              }
              sidePanel={modeSidePanel}
              splitRatio={showSplitLayout ? "1fr 1fr" : "1fr"}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">{chatContent}</div>
          ))}
      </section>
    </div>
  );
}
