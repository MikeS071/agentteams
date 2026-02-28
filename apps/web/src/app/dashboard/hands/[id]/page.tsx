"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  buildToolUsageFromHistory,
  normalizeHandDetailPayload,
  normalizeHandHistoryPayload,
  type HandConversation,
  type HandDetail,
  type TokenUsagePoint,
  type ToolUsagePoint,
} from "@/lib/hands";

function statusBadgeClass(status: string): string {
  switch (status) {
    case "active":
    case "running":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "paused":
    case "idle":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "error":
    case "failed":
      return "border-red-500/30 bg-red-500/10 text-red-300";
    default:
      return "border-gray-600/50 bg-gray-600/10 text-gray-300";
  }
}

function toolSuccessRate(entry: ToolUsagePoint): number {
  const total = entry.success + entry.failure;
  if (total === 0) {
    return 0;
  }
  return Math.round((entry.success / total) * 100);
}

function formatDateLabel(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function deriveDailyUsageFromHistory(history: HandConversation[]): TokenUsagePoint[] {
  const byDay = new Map<string, number>();

  for (const conversation of history) {
    if (!conversation.createdAt) {
      continue;
    }

    const date = new Date(conversation.createdAt);
    if (Number.isNaN(date.getTime())) {
      continue;
    }

    const day = date.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + conversation.tokenCount);
  }

  return Array.from(byDay.entries())
    .map(([date, tokens]) => ({ date, tokens }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const numberFormatter = new Intl.NumberFormat("en-US");

export default function HandDetailPage() {
  const params = useParams<{ id: string }>();
  const handId = params?.id;

  const [detail, setDetail] = useState<HandDetail | null>(null);
  const [history, setHistory] = useState<HandConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

  const [systemPrompt, setSystemPrompt] = useState("");
  const [model, setModel] = useState("");
  const [enabledTools, setEnabledTools] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    if (!handId) {
      return;
    }

    try {
      const [detailResponse, historyResponse] = await Promise.all([
        fetch(`/api/hands/${handId}`, { cache: "no-store" }),
        fetch(`/api/hands/${handId}/history`, { cache: "no-store" }),
      ]);

      if (!detailResponse.ok || !historyResponse.ok) {
        throw new Error("Failed to load hand data");
      }

      const [detailPayload, historyPayload] = (await Promise.all([
        detailResponse.json(),
        historyResponse.json(),
      ])) as [unknown, unknown];

      const nextDetail = normalizeHandDetailPayload(detailPayload);
      const nextHistory = normalizeHandHistoryPayload(historyPayload).slice(0, 20);

      setDetail(nextDetail);
      setHistory(nextHistory);
      setSystemPrompt(nextDetail.systemPrompt);
      setModel(nextDetail.model);
      setEnabledTools(nextDetail.enabledTools);
      setSelectedConversationId((current) => current ?? (nextHistory[0]?.id ?? null));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load hand data");
    } finally {
      setLoading(false);
    }
  }, [handId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedConversation = useMemo(() => {
    return history.find((conversation) => conversation.id === selectedConversationId) ?? null;
  }, [history, selectedConversationId]);

  const toolUsage = useMemo(() => {
    if (detail?.toolUsage?.length) {
      return [...detail.toolUsage].sort((a, b) => b.success + b.failure - (a.success + a.failure));
    }

    return buildToolUsageFromHistory(history).sort((a, b) => b.success + b.failure - (a.success + a.failure));
  }, [detail?.toolUsage, history]);

  const tokenUsageDaily = useMemo(() => {
    if (detail?.tokenUsageDaily?.length) {
      return detail.tokenUsageDaily;
    }
    return deriveDailyUsageFromHistory(history);
  }, [detail?.tokenUsageDaily, history]);

  const toolOptions = useMemo(() => {
    const names = new Set<string>();

    for (const tool of detail?.availableTools ?? []) {
      names.add(tool);
    }
    for (const tool of detail?.enabledTools ?? []) {
      names.add(tool);
    }
    for (const entry of toolUsage) {
      names.add(entry.tool);
    }

    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [detail?.availableTools, detail?.enabledTools, toolUsage]);

  async function handleSaveConfig(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!handId) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/hands/${handId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_prompt: systemPrompt,
          model,
          enabled_tools: enabledTools,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save hand config");
      }

      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save hand config");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0a0a0f] text-sm text-gray-400">
        Loading hand dashboard...
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0a0a0f] text-sm text-red-400">
        {error ?? "Hand not found"}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-[#0a0a0f] px-4 py-5 sm:px-6">
      <div className="mx-auto w-full max-w-7xl">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/dashboard/hands" className="text-xs text-[#a29bfe] hover:text-[#b9b3ff]">
              ← Back to hands
            </Link>
            <h1 className="mt-1 text-2xl font-semibold text-white">{detail.name}</h1>
            <p className="mt-1 text-sm text-gray-400">{detail.description || "No description"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-300">
            <span className={`rounded-full border px-2 py-1 capitalize ${statusBadgeClass(detail.status)}`}>{detail.status}</span>
            <span className="rounded-full border border-[#2a2a3c] bg-[#13131f] px-2 py-1">Model: {detail.model}</span>
            <span className="rounded-full border border-[#2a2a3c] bg-[#13131f] px-2 py-1">
              Tokens today: {numberFormatter.format(detail.tokensToday)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <section className="rounded-xl border border-[#232336] bg-[#101019] p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Conversation History</h2>
                <span className="text-xs text-gray-400">Last {history.length} conversations</span>
              </div>

              <div className="grid gap-3 md:grid-cols-[minmax(0,280px)_1fr]">
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {history.length === 0 ? (
                    <p className="text-sm text-gray-500">No conversation history for this hand yet.</p>
                  ) : (
                    history.map((conversation) => (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => setSelectedConversationId(conversation.id)}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                          selectedConversationId === conversation.id
                            ? "border-[#6c5ce7]/60 bg-[#171728]"
                            : "border-[#24243a] bg-[#12121d] hover:bg-[#171725]"
                        }`}
                      >
                        <p className="truncate text-sm font-medium text-gray-100">{conversation.title}</p>
                        <p className="mt-1 text-xs text-gray-400">
                          {conversation.createdAt ? formatDateLabel(conversation.createdAt) : "Unknown date"} · {numberFormatter.format(conversation.tokenCount)} tokens
                        </p>
                      </button>
                    ))
                  )}
                </div>

                <div className="rounded-lg border border-[#24243a] bg-[#12121d] p-3">
                  {selectedConversation ? (
                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-white">{selectedConversation.title}</p>
                          <p className="text-xs text-gray-400 capitalize">Status: {selectedConversation.status}</p>
                        </div>
                        <Link
                          href={`/dashboard/chat?conversationId=${selectedConversation.id}`}
                          className="text-xs font-medium text-[#a29bfe] hover:text-[#b9b3ff]"
                        >
                          Open in chat
                        </Link>
                      </div>
                      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                        {selectedConversation.messages.length === 0 ? (
                          <p className="text-sm text-gray-500">Message preview unavailable.</p>
                        ) : (
                          selectedConversation.messages.map((message, index) => (
                            <div
                              key={`${message.role}-${index}-${message.content.slice(0, 12)}`}
                              className="rounded-md border border-[#2a2a40] bg-[#151525] p-2"
                            >
                              <p className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">{message.role}</p>
                              <p className="whitespace-pre-wrap text-sm text-gray-200">{message.content}</p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Select a conversation to view details.</p>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-[#232336] bg-[#101019] p-4">
              <h2 className="text-lg font-semibold text-white">Token Usage (Daily)</h2>
              <p className="mt-1 text-xs text-gray-400">Per-day token usage for this hand.</p>

              <div className="mt-3 h-64 rounded-lg border border-[#24243a] bg-[#12121d] p-3">
                {tokenUsageDaily.length === 0 ? (
                  <p className="pt-20 text-center text-sm text-gray-500">No token usage data yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={tokenUsageDaily} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="tokensGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6c5ce7" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#6c5ce7" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#25253a" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatDateLabel}
                        stroke="#8a8aa3"
                        tickLine={false}
                        axisLine={false}
                        fontSize={12}
                      />
                      <YAxis stroke="#8a8aa3" tickLine={false} axisLine={false} fontSize={12} />
                      <Tooltip
                        labelFormatter={(label) => formatDateLabel(String(label))}
                        formatter={(value) => [numberFormatter.format(Number(value)), "Tokens"]}
                        contentStyle={{ backgroundColor: "#101019", border: "1px solid #2a2a3d", borderRadius: "8px" }}
                      />
                      <Area type="monotone" dataKey="tokens" stroke="#6c5ce7" fill="url(#tokensGradient)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>
          </div>

          <div className="space-y-4">
            <section className="rounded-xl border border-[#232336] bg-[#101019] p-4">
              <h2 className="text-lg font-semibold text-white">Tool Usage</h2>
              <p className="mt-1 text-xs text-gray-400">Most-used tools and success rates.</p>

              <div className="mt-3 space-y-2">
                {toolUsage.length === 0 ? (
                  <p className="text-sm text-gray-500">No tool usage recorded yet.</p>
                ) : (
                  toolUsage.map((entry) => (
                    <div key={entry.tool} className="rounded-lg border border-[#24243a] bg-[#12121d] p-3">
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <p className="font-medium text-gray-100">{entry.tool}</p>
                        <p className="text-xs text-gray-400">{toolSuccessRate(entry)}% success</p>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[#1f1f30]">
                        <div className="h-full bg-[#6c5ce7]" style={{ width: `${toolSuccessRate(entry)}%` }} />
                      </div>
                      <div className="mt-2 flex justify-between text-xs text-gray-400">
                        <span>Success: {entry.success}</span>
                        <span>Failure: {entry.failure}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-xl border border-[#232336] bg-[#101019] p-4">
              <h2 className="text-lg font-semibold text-white">Config Panel</h2>
              <p className="mt-1 text-xs text-gray-400">Update prompt, model, and enabled tools.</p>

              <form onSubmit={(event) => void handleSaveConfig(event)} className="mt-3 space-y-3">
                <label className="block text-xs text-gray-300">
                  System Prompt
                  <textarea
                    value={systemPrompt}
                    onChange={(event) => setSystemPrompt(event.currentTarget.value)}
                    rows={7}
                    className="mt-1 w-full rounded-lg border border-[#2b2b41] bg-[#12121d] px-3 py-2 text-sm text-gray-100 outline-none focus:border-[#6c5ce7]"
                  />
                </label>

                <label className="block text-xs text-gray-300">
                  Model
                  <input
                    type="text"
                    value={model}
                    onChange={(event) => setModel(event.currentTarget.value)}
                    className="mt-1 w-full rounded-lg border border-[#2b2b41] bg-[#12121d] px-3 py-2 text-sm text-gray-100 outline-none focus:border-[#6c5ce7]"
                  />
                </label>

                <div>
                  <p className="text-xs text-gray-300">Enabled Tools</p>
                  <div className="mt-2 max-h-36 space-y-1 overflow-y-auto rounded-lg border border-[#2b2b41] bg-[#12121d] p-2">
                    {toolOptions.length === 0 ? (
                      <p className="text-xs text-gray-500">No tool options available.</p>
                    ) : (
                      toolOptions.map((tool) => (
                        <label key={tool} className="flex items-center gap-2 text-xs text-gray-200">
                          <input
                            type="checkbox"
                            checked={enabledTools.includes(tool)}
                            onChange={(event) => {
                              setEnabledTools((current) => {
                                if (event.currentTarget.checked) {
                                  return [...current, tool];
                                }
                                return current.filter((entry) => entry !== tool);
                              });
                            }}
                            className="h-4 w-4 accent-[#6c5ce7]"
                          />
                          {tool}
                        </label>
                      ))
                    )}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className="w-full rounded-lg bg-[#6c5ce7] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Configuration"}
                </button>
              </form>
            </section>
          </div>
        </div>

        {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}
      </div>
    </div>
  );
}
