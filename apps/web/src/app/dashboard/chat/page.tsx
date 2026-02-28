"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ChatInput from "@/components/ChatInput";
import ChatMessage from "@/components/ChatMessage";
import AgentSetup from "@/components/AgentSetup";
import { AGENTS, type AgentType } from "@/lib/agents";

type Role = "user" | "assistant" | "system";
type Message = { id?: string; role: Role; content: string; createdAt?: string };
type Conversation = { id: string; preview: string; createdAt: string; lastActivityAt: string };

function LoadingDots() {
  return (
    <div className="inline-flex items-center gap-1">
      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.2s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.1s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
    </div>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const endRef = useRef<HTMLDivElement | null>(null);

  const [selectedAgent, setSelectedAgent] = useState<AgentType>(AGENTS[0]);
  const [showSetup, setShowSetup] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [replyLoading, setReplyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeConversationId = useMemo(() => searchParams.get("conversationId") || undefined, [searchParams]);

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/chat/conversations", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed");
    const data = (await res.json()) as { conversations: Conversation[] };
    setConversations(data.conversations || []);
  }, []);

  const loadHistory = useCallback(async (id: string) => {
    setHistoryLoading(true);
    setError(null);
    setShowSetup(false);
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

  useEffect(() => { void loadConversations().catch(() => {}); }, [loadConversations]);
  useEffect(() => { if (activeConversationId) void loadHistory(activeConversationId); }, [activeConversationId, loadHistory]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, replyLoading]);

  const handleSend = useCallback(
    async (text: string, model?: string) => {
      const userMsg: Message = { role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);
      setReplyLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            message: text,
            model,
            agentId: selectedAgent.id,
            systemPrompt: selectedAgent.id !== "chat" ? selectedAgent.systemPrompt : undefined,
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
    [conversationId, loadConversations, router, selectedAgent]
  );

  function handleAgentClick(agent: AgentType) {
    setSelectedAgent(agent);
    if (agent.fields.length === 0) {
      // General Chat — start immediately
      setShowSetup(false);
      setConversationId(undefined);
      setMessages([{ role: "assistant", content: agent.welcomeMessage }]);
      router.replace("/dashboard/chat");
    } else {
      setShowSetup(true);
    }
  }

  function handleAgentStart(context: string) {
    setShowSetup(false);
    setConversationId(undefined);
    setMessages([{ role: "assistant", content: selectedAgent.welcomeMessage }]);
    router.replace("/dashboard/chat");
    void handleSend(context);
  }

  function handleNewChat() {
    setConversationId(undefined);
    setMessages([]);
    setError(null);
    setShowSetup(false);
    setSelectedAgent(AGENTS[0]);
    router.replace("/dashboard/chat");
  }

  const hasChat = messages.length > 0 || conversationId;

  return (
    <div className="relative flex h-full min-h-0 bg-[#0a0a0f]">
      {/* Mobile sidebar toggle */}
      {sidebarOpen && (
        <button type="button" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-20 bg-black/40 md:hidden" aria-label="Close" />
      )}

      {/* Sidebar: conversations top, agents bottom */}
      <aside className={`absolute inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-[#1f1f2f] bg-[#0d0d15] transition-transform md:static md:z-0 md:w-80 md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        {/* Top: Conversations */}
        <div className="flex items-center justify-between border-b border-[#1f1f2f] p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Conversations</h2>
          <button type="button" onClick={handleNewChat} className="rounded-md bg-[#6c5ce7] px-2.5 py-1 text-xs font-medium text-white hover:opacity-90">+ New</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <p className="px-2 py-3 text-xs text-gray-600">No conversations yet</p>
          ) : (
            conversations.map((c) => (
              <button key={c.id} type="button"
                onClick={() => { setSidebarOpen(false); router.replace(`/dashboard/chat?conversationId=${c.id}`); }}
                className={`mb-0.5 w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${c.id === conversationId ? "bg-[#18182a] text-gray-100" : "text-gray-400 hover:bg-[#141422] hover:text-gray-200"}`}
              >
                <p className="truncate">{c.preview}</p>
              </button>
            ))
          )}
        </div>

        {/* Bottom: Agent grid */}
        <div className="border-t border-[#1f1f2f]">
          <div className="px-2 py-1.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Agents</h2>
          </div>
          <div className="grid grid-cols-3 gap-1.5 p-2 pt-1">
            {AGENTS.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => handleAgentClick(agent)}
                className={`group relative overflow-hidden rounded-xl border transition-all ${
                  selectedAgent.id === agent.id
                    ? "border-[#6c5ce7] ring-1 ring-[#6c5ce7]/50"
                    : "border-[#1f1f2f] hover:border-[#3a3a5d]"
                }`}
              >
                {agent.image ? (
                  <div className="relative">
                    <img
                      src={agent.image}
                      alt={agent.name}
                      className="h-14 w-full object-cover opacity-70 transition-opacity group-hover:opacity-100"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0d0d15] via-transparent to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-2">
                      <p className="text-[10px] font-semibold leading-tight text-white">{agent.name}</p>
                    </div>
                    {/* Accent bar on hover */}
                    <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-[#6c5ce7] to-[#a855f7] opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                ) : (
                  <div className="flex h-14 flex-col items-center justify-center gap-0.5 bg-[#12121a]">
                    <span className="text-base">{agent.icon}</span>
                    <p className="text-[10px] font-semibold leading-tight text-gray-300">{agent.name}</p>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <section className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#1f1f2f] px-3 py-2">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setSidebarOpen((o) => !o)} className="rounded-md border border-[#2a2a3d] px-3 py-1.5 text-sm text-gray-200 md:hidden">☰</button>
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span>{selectedAgent.icon}</span>
              <span className="font-medium text-gray-200">{selectedAgent.name}</span>
            </div>
          </div>
        </div>

        {/* Setup overlay */}
        {showSetup && (
          <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
            <AgentSetup agent={selectedAgent} onStart={handleAgentStart} onBack={() => setShowSetup(false)} />
          </div>
        )}

        {/* Chat area */}
        {!showSetup && (
          <>
            <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-5">
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
                {historyLoading ? (
                  <p className="text-sm text-gray-400">Loading conversation...</p>
                ) : !hasChat ? (
                  <div className="flex flex-col items-center justify-center gap-4 pt-20 text-center">
                    <span className="text-5xl">{selectedAgent.icon}</span>
                    <h2 className="text-xl font-bold text-white">{selectedAgent.name}</h2>
                    <p className="max-w-md text-sm text-gray-400">{selectedAgent.description}</p>
                    <p className="text-xs text-gray-600">Select an agent from the sidebar or start typing below</p>
                  </div>
                ) : (
                  messages.map((message, index) => (
                    <ChatMessage key={message.id || `${message.role}-${index}-${message.content.slice(0, 20)}`} role={message.role} content={message.content} />
                  ))
                )}
                {replyLoading && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-bl-md border border-[#23233a] bg-[#12121a] px-4 py-3 text-sm text-gray-100"><LoadingDots /></div>
                  </div>
                )}
                {error && <p className="text-sm text-red-400">{error}</p>}
                <div ref={endRef} />
              </div>
            </div>
            <ChatInput onSend={handleSend} disabled={replyLoading || historyLoading} />
          </>
        )}
      </section>
    </div>
  );
}
