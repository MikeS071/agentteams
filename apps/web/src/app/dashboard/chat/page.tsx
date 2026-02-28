"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AgentGrid from "@/components/AgentGrid";
import AgentSetup, { type AgentWizardConfig } from "@/components/AgentSetup";
import ChatInput from "@/components/ChatInput";
import ChatMessage from "@/components/ChatMessage";
import { AGENTS, getAgent, type AgentType } from "@/lib/agents";

type Role = "user" | "assistant" | "system";
type Message = { id?: string; role: Role; content: string; createdAt?: string };
type Conversation = { id: string; preview: string; createdAt: string; lastActivityAt: string };

type AgentConfigMap = Record<string, AgentWizardConfig>;

type HandConfigResponse = {
  configs?: Record<string, { id: string; systemPrompt: string; modelPreference: string; enabledTools: string[] }>;
};

const AGENT_ORDER = [
  "research",
  "coder",
  "leadgen",
  "intel",
  "social",
  "browser",
  "clip",
  "chat",
] as const;

const SELECTED_AGENT_KEY = "openfang:selected-agent";
const AGENT_CONFIGS_KEY = "openfang:agent-configs-v1";
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

export default function ChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const endRef = useRef<HTMLDivElement | null>(null);

  const [selectedAgent, setSelectedAgent] = useState<AgentType>(getAgent("chat"));
  const [wizardAgent, setWizardAgent] = useState<AgentType | null>(null);
  const [agentConfigs, setAgentConfigs] = useState<AgentConfigMap>(defaultConfigs);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [replyLoading, setReplyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeConversationId = useMemo(() => searchParams.get("conversationId") || undefined, [searchParams]);

  const orderedAgents = useMemo(
    () => AGENT_ORDER.map((id) => AGENTS.find((agent) => agent.id === id)).filter((agent): agent is AgentType => Boolean(agent)),
    []
  );

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

  const handleSend = useCallback(
    async (text: string, model?: string) => {
      const userMsg: Message = { role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);
      setReplyLoading(true);
      setError(null);

      const selectedConfig = agentConfigs[selectedAgent.id] ?? normalizeConfig(selectedAgent);
      const resolvedModel = model || selectedConfig.modelPreference || undefined;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            message: text,
            model: resolvedModel,
            agentId: selectedAgent.id,
            systemPrompt: selectedConfig.systemPrompt,
            enabledTools: selectedConfig.enabledTools,
          }),
        });
        const data = (await res.json()) as { error?: string; conversationId?: string; message?: Message };
        if (!res.ok || !data.message || !data.conversationId) throw new Error(data.error || "Failed");
        if (conversationId !== data.conversationId) {
          setConversationId(data.conversationId);
          router.replace(`/dashboard/chat?conversationId=${data.conversationId}`);
        }
        setMessages((prev) => [...prev, data.message as Message]);
        await loadConversations();
      } catch {
        setMessages((prev) => [...prev, { role: "assistant", content: "I couldn't process that. Please try again." }]);
      } finally {
        setReplyLoading(false);
      }
    },
    [agentConfigs, conversationId, loadConversations, router, selectedAgent]
  );

  function handleAgentSelect(agent: AgentType) {
    setSelectedAgent(agent);
    setSidebarOpen(false);
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
  const currentAgentConfig = agentConfigs[selectedAgent.id] ?? normalizeConfig(selectedAgent);

  return (
    <div className="relative flex h-full max-h-full min-h-0 bg-[#0a0a0b]">
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

          <AgentGrid
            agents={orderedAgents}
            selectedAgentId={selectedAgent.id}
            onSelect={handleAgentSelect}
            onConfigure={handleAgentConfigOpen}
          />
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
              <span className="rounded-full bg-[#173425] px-2 py-0.5 text-xs text-[#9ff1c5]">active</span>
            </div>
          </div>
        </div>

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

        {!wizardAgent && (
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
                      Pick any of the 8 agents from the grid and start chatting, or use Config to tune this Hand.
                    </p>
                  </div>
                ) : (
                  messages.map((message, index) => (
                    <ChatMessage
                      key={message.id || `${message.role}-${index}-${message.content.slice(0, 20)}`}
                      role={message.role}
                      content={message.content}
                    />
                  ))
                )}

                {replyLoading && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-bl-md border border-[#23233a] bg-[#12121a] px-4 py-3 text-sm text-gray-100">
                      <LoadingDots />
                    </div>
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
                  {currentAgentConfig.modelPreference}
                </span>
              </div>
            </div>

            <ChatInput
              onSend={handleSend}
              disabled={replyLoading || historyLoading}
              preferredModel={currentAgentConfig.modelPreference}
            />
          </>
        )}
      </section>
    </div>
  );
}
