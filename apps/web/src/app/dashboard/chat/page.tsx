"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AgentGrid from "@/components/AgentGrid";
import AgentModeLayout from "@/components/AgentModeLayout";
import AgentModeSelector from "@/components/AgentModeSelector";
import AgentSetup, { type AgentWizardConfig } from "@/components/AgentSetup";
import ChatInput from "@/components/ChatInput";
import ChatMessage from "@/components/ChatMessage";
import IntelPanel from "@/components/IntelPanel";
import MediaPanel from "@/components/MediaPanel";
import ResearchPanel from "@/components/ResearchPanel";
import SocialPanel from "@/components/SocialPanel";
import SwarmStatus from "@/components/SwarmStatus";
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

type AgentConfigMap = Record<string, AgentWizardConfig>;
type Model = { id: string; name: string; provider: string };

type HandConfigResponse = {
  configs?: Record<string, { id: string; systemPrompt: string; modelPreference: string; enabledTools: string[] }>;
};

const AGENT_ORDER = ["research", "coder", "intel", "social", "clip", "chat"] as const;

const SELECTED_AGENT_KEY = "openfang:selected-agent";
const AGENT_CONFIGS_KEY = "openfang:agent-configs-v1";
const MODEL_SELECTIONS_KEY = "openfang:model-selections-v1";
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_TOOLS = ["web_search", "web_fetch"];

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
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<Message[]>([]);
  const [swarmVisible, setSwarmVisible] = useState(true);
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
      setActiveMode((mode) => mode ?? selectedAgent.id);
    } catch {
      setError("Could not load this conversation.");
    } finally {
      setHistoryLoading(false);
    }
  }, [selectedAgent.id]);

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
      const agent = getAgent(savedAgent);
      setSelectedAgent(agent);
      setActiveMode(agent.id);
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
              if (["assistant_message", "message", "final", "agent_completed", "done", "complete"].includes(effectiveType) && textValue) {
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
      } catch {
        updateAssistantMessage(assistantId, () => ({
          id: assistantId,
          role: "assistant",
          content: "I couldn't process that. Please try again.",
          suggestions: [
            "Retry with a shorter prompt.",
            "Ask for a concise answer first, then details.",
            "Try a different model for this agent.",
          ],
          tools: [],
        }));
      } finally {
        setReplyLoading(false);
      }
    },
    [activeModelId, agentConfigs, conversationId, router, selectedAgent, updateAssistantMessage]
  );

  function handleAgentSelect(agent: AgentType) {
    setSelectedAgent(agent);
    setActiveMode(agent.id);
    setWizardAgent(null);
  }

  function handleModeSwitch(agent: AgentType) {
    setSelectedAgent(agent);
    setActiveMode(agent.id);
    setWizardAgent(null);
  }

  function handleAgentConfigOpen(agent: AgentType) {
    setSelectedAgent(agent);
    setActiveMode(agent.id);
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
    router.replace("/dashboard/chat");
  }

  function handleBackToGrid() {
    setWizardAgent(null);
    setActiveMode(null);
  }

  const hasChat = messages.length > 0 || Boolean(conversationId);

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

  const sidePanel = useMemo(() => {
    if (selectedAgent.id === "research") {
      return <ResearchPanel messages={messages} />;
    }
    if (selectedAgent.id === "intel") {
      return <IntelPanel messages={messages} />;
    }
    if (selectedAgent.id === "social") {
      const assistantMessages = messages
        .filter((message) => message.role === "assistant")
        .map((message) => message.content);
      return <SocialPanel assistantMessages={assistantMessages} />;
    }
    if (selectedAgent.id === "clip") {
      return <MediaPanel messages={messages} />;
    }
    return undefined;
  }, [messages, selectedAgent.id]);

  const chatPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-[#1a1a1f] px-3 py-2">
        <div className="flex items-center gap-2 text-sm text-gray-300">
          <span>{selectedAgent.icon}</span>
          <span className="font-medium text-gray-100">{selectedAgent.name}</span>
          <span className="rounded-full bg-[#173425] px-2 py-0.5 text-xs text-[#9ff1c5]">active</span>
        </div>
        <span className="truncate rounded-full border border-[#2f2f3a] bg-[#15151d] px-2.5 py-1 font-mono text-xs text-gray-300">
          {activeModelLabel}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
          {historyLoading ? (
            <p className="text-sm text-gray-400">Loading conversation...</p>
          ) : !hasChat ? (
            <div className="flex flex-col items-center justify-center gap-4 pt-20 text-center">
              <span className="text-5xl">{selectedAgent.icon}</span>
              <h2 className="text-xl font-bold text-white">{selectedAgent.name}</h2>
              <p className="max-w-md text-sm text-gray-400">{selectedAgent.description}</p>
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
        </div>
      </div>

      <ChatInput onSend={handleSend} disabled={replyLoading || historyLoading} />
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[#0a0a0b]">
      {activeMode === null ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto w-full max-w-6xl space-y-5">
            <div>
              <h1 className="text-2xl font-semibold text-gray-100">Choose an AI Agent to get started</h1>
              <p className="mt-1 text-sm text-gray-400">Select a mode, then chat with shared history across switches.</p>
            </div>
            <AgentGrid
              variant="hero"
              agents={orderedAgents}
              selectedAgentId={selectedAgent.id}
              onSelect={handleAgentSelect}
              onConfigure={handleAgentConfigOpen}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="border-b border-[#1a1a1f] bg-[#0d0d12] px-3 py-2 sm:px-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <button
                  type="button"
                  onClick={handleBackToGrid}
                  className="shrink-0 rounded-md border border-[#2a2a33] px-3 py-1.5 text-xs text-gray-200 hover:border-[#3a3a45]"
                >
                  Back to agents
                </button>
                <AgentModeSelector agents={orderedAgents} activeAgentId={selectedAgent.id} onSelect={handleModeSwitch} />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWizardAgent(selectedAgent)}
                  className="rounded-md border border-[#2f2f37] px-3 py-1.5 text-xs text-gray-300 hover:text-white"
                >
                  Configure
                </button>
                <select
                  value={activeModelId}
                  onChange={(event) => {
                    const next = event.target.value;
                    setModelSelections((prev) => ({ ...prev, [selectedAgent.id]: next }));
                  }}
                  className="h-8 max-w-[240px] rounded-md border border-[#2c3440] bg-[#0c0f14] px-2 text-xs text-gray-200 focus:border-[#3b82f6] focus:outline-none"
                  aria-label="Select model"
                >
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.provider} · {model.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleNewChat}
                  className="rounded-md bg-[#2563eb] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1d4ed8]"
                >
                  + New Chat
                </button>
              </div>
            </div>
          </div>

          {wizardAgent ? (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4 sm:p-6">
              <AgentSetup
                agent={wizardAgent}
                initialConfig={agentConfigs[wizardAgent.id] ?? normalizeConfig(wizardAgent)}
                onSave={handleAgentConfigSave}
                onBack={() => setWizardAgent(null)}
              />
            </div>
          ) : (
            <>
              {swarmVisible ? (
                <SwarmStatus
                  compact
                  projectName="agentsquads"
                  onClose={() => setSwarmVisible(false)}
                />
              ) : null}
              <AgentModeLayout
                agentId={selectedAgent.id}
                chatPanel={chatPanel}
                sidePanel={sidePanel}
                splitRatio={sidePanel ? "minmax(0, 1fr) minmax(0, 1fr)" : "1fr"}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
