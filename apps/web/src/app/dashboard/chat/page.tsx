"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ChatInput from "@/components/ChatInput";
import ChatMessage from "@/components/ChatMessage";
import AgentPicker from "@/components/AgentPicker";
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

type Phase = "pick" | "setup" | "chat";

export default function ChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const endRef = useRef<HTMLDivElement | null>(null);

  const [phase, setPhase] = useState<Phase>("pick");
  const [selectedAgent, setSelectedAgent] = useState<AgentType>(AGENTS[0]);
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
    if (!res.ok) throw new Error("Failed to load conversations");
    const data = (await res.json()) as { conversations: Conversation[] };
    setConversations(data.conversations || []);
  }, []);

  const loadHistory = useCallback(async (id: string) => {
    setHistoryLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/chat/history?conversationId=${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load chat history");
      const data = (await res.json()) as { messages: Message[] };
      setMessages(data.messages || []);
      setConversationId(id);
      setPhase("chat");
      setSidebarOpen(false);
    } catch {
      setError("Could not load this conversation.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { void loadConversations().catch(() => setError("Could not load conversations.")); }, [loadConversations]);

  useEffect(() => {
    if (activeConversationId) { void loadHistory(activeConversationId); return; }
    // Don't reset phase if we're in agent selection flow
  }, [activeConversationId, loadHistory]);

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
        if (!res.ok || !data.message || !data.conversationId) throw new Error(data.error || "Failed to send message");

        if (conversationId !== data.conversationId) {
          setConversationId(data.conversationId);
          router.replace(`/dashboard/chat?conversationId=${data.conversationId}`);
        }

        setMessages((prev) => [...prev, data.message as Message]);
        await loadConversations();
      } catch {
        setMessages((prev) => [...prev, { role: "assistant", content: "I couldn't process that request right now. Please try again." }]);
        setError("Failed to send message.");
      } finally {
        setReplyLoading(false);
      }
    },
    [conversationId, loadConversations, router, selectedAgent]
  );

  function handleAgentSelect(agent: AgentType) {
    setSelectedAgent(agent);
    if (agent.fields.length === 0) {
      // No setup needed (General Chat) — go straight to chat
      setPhase("chat");
      setConversationId(undefined);
      setMessages([{ role: "assistant", content: agent.welcomeMessage }]);
    } else {
      setPhase("setup");
    }
  }

  function handleAgentStart(context: string) {
    setPhase("chat");
    setConversationId(undefined);
    // Show welcome + auto-send the context as first user message
    setMessages([{ role: "assistant", content: selectedAgent.welcomeMessage }]);
    void handleSend(context);
  }

  function handleNewChat() {
    setConversationId(undefined);
    setMessages([]);
    setError(null);
    setSidebarOpen(false);
    setPhase("pick");
    router.replace("/dashboard/chat");
  }

  return (
    <div className="relative flex h-full min-h-0 bg-[#0a0a0f]">
      {sidebarOpen && (
        <button type="button" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-20 bg-black/40 md:hidden" aria-label="Close" />
      )}

      <aside className={`absolute inset-y-0 left-0 z-30 w-72 border-r border-[#1f1f2f] bg-[#0d0d15] transition-transform md:static md:z-0 md:w-80 md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between border-b border-[#1f1f2f] p-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-300">Conversations</h2>
          <button type="button" onClick={handleNewChat} className="rounded-md bg-[#6c5ce7] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">New Chat</button>
        </div>
        <div className="h-[calc(100%-57px)] overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[#2a2a3d] px-3 py-4 text-sm text-gray-500">No conversations yet.</p>
          ) : (
            conversations.map((c) => (
              <button key={c.id} type="button"
                onClick={() => { setSidebarOpen(false); router.replace(`/dashboard/chat?conversationId=${c.id}`); }}
                className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm ${c.id === conversationId ? "bg-[#18182a] text-gray-100" : "text-gray-400 hover:bg-[#141422] hover:text-gray-200"}`}
              >
                <p className="truncate">{c.preview}</p>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-[#1f1f2f] px-3 py-2">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setSidebarOpen((o) => !o)} className="rounded-md border border-[#2a2a3d] px-3 py-1.5 text-sm text-gray-200 md:hidden">Menu</button>
            {phase === "chat" && (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <span>{selectedAgent.icon}</span>
                <span className="font-medium text-gray-200">{selectedAgent.name}</span>
                <button type="button" onClick={handleNewChat} className="ml-2 rounded border border-[#2a2a3d] px-2 py-0.5 text-xs text-gray-500 hover:text-white">Change</button>
              </div>
            )}
          </div>
          <button type="button" onClick={handleNewChat} className="rounded-md bg-[#6c5ce7] px-3 py-1.5 text-sm text-white md:hidden">New</button>
        </div>

        {phase === "pick" && (
          <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
            <div className="w-full max-w-2xl space-y-6">
              <div className="text-center">
                <h1 className="text-2xl font-bold text-white">Choose an Agent</h1>
                <p className="mt-1 text-sm text-gray-400">Pick a specialist or start a freeform chat</p>
              </div>
              <AgentPicker selected={selectedAgent.id} onSelect={handleAgentSelect} />
            </div>
          </div>
        )}

        {phase === "setup" && (
          <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
            <AgentSetup agent={selectedAgent} onStart={handleAgentStart} onBack={() => setPhase("pick")} />
          </div>
        )}

        {phase === "chat" && (
          <>
            <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-5">
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
                {historyLoading ? (
                  <p className="text-sm text-gray-400">Loading conversation...</p>
                ) : messages.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#26263a] bg-[#101018] p-6 text-center text-sm text-gray-500">
                    Start a new conversation from the input below.
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
