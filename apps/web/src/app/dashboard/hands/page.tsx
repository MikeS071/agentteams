"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { normalizeHandsPayload, type HandSummary } from "@/lib/hands";

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

const numberFormatter = new Intl.NumberFormat("en-US");

export default function HandsOverviewPage() {
  const [hands, setHands] = useState<HandSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadHands = useCallback(async () => {
    try {
      const response = await fetch("/api/hands", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed to load hands");
      }
      const payload = (await response.json()) as unknown;
      setHands(normalizeHandsPayload(payload));
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load hands";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHands();
  }, [loadHands]);

  const quickStats = useMemo(() => {
    return hands.reduce(
      (acc, hand) => {
        acc.totalConversations += hand.totalConversations;
        acc.tokensToday += hand.tokensToday;
        if (hand.enabled) {
          acc.enabled += 1;
        }
        return acc;
      },
      { totalConversations: 0, tokensToday: 0, enabled: 0 }
    );
  }, [hands]);

  async function handleToggle(hand: HandSummary, nextEnabled: boolean) {
    setSavingId(hand.id);
    setHands((prev) => prev.map((item) => (item.id === hand.id ? { ...item, enabled: nextEnabled } : item)));

    try {
      const response = await fetch(`/api/hands/${hand.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      });

      if (!response.ok) {
        throw new Error("Failed to update hand status");
      }
    } catch (err) {
      setHands((prev) => prev.map((item) => (item.id === hand.id ? { ...item, enabled: hand.enabled } : item)));
      setError(err instanceof Error ? err.message : "Failed to update hand status");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-[#0a0a0f] px-4 py-5 sm:px-6">
      <div className="mx-auto w-full max-w-7xl">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-100">Hands Dashboard</h1>
            <p className="mt-1 text-sm text-gray-400">Overview of all agent hands, runtime status, and usage.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void loadHands();
            }}
            className="rounded-lg border border-[#272739] bg-[#141422] px-3 py-2 text-sm text-gray-200 hover:bg-[#1a1a2b]"
          >
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-[#232336] bg-[#101019] p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Total Conversations</p>
            <p className="mt-2 text-2xl font-semibold text-white">{numberFormatter.format(quickStats.totalConversations)}</p>
          </div>
          <div className="rounded-xl border border-[#232336] bg-[#101019] p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Tokens Used Today</p>
            <p className="mt-2 text-2xl font-semibold text-white">{numberFormatter.format(quickStats.tokensToday)}</p>
          </div>
          <div className="rounded-xl border border-[#232336] bg-[#101019] p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Enabled Hands</p>
            <p className="mt-2 text-2xl font-semibold text-white">
              {quickStats.enabled} / {hands.length || 6}
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {loading ? (
            <div className="col-span-full rounded-xl border border-[#232336] bg-[#101019] p-5 text-sm text-gray-400">
              Loading hands...
            </div>
          ) : hands.length === 0 ? (
            <div className="col-span-full rounded-xl border border-[#232336] bg-[#101019] p-5 text-sm text-gray-500">
              No hands available.
            </div>
          ) : (
            hands.map((hand) => (
              <div key={hand.id} className="rounded-xl border border-[#232336] bg-[#101019] p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-semibold text-white">{hand.name}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-gray-400">{hand.description || "No description"}</p>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-xs capitalize ${statusBadgeClass(hand.status)}`}>
                    {hand.status}
                  </span>
                </div>

                <div className="mt-4 space-y-1 text-xs text-gray-300">
                  <p>
                    Model: <span className="text-gray-100">{hand.model}</span>
                  </p>
                  <p>
                    Conversations: <span className="text-gray-100">{numberFormatter.format(hand.totalConversations)}</span>
                  </p>
                  <p>
                    Tokens today: <span className="text-gray-100">{numberFormatter.format(hand.tokensToday)}</span>
                  </p>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-[#222236] pt-3">
                  <label className="flex items-center gap-2 text-xs text-gray-300">
                    <input
                      type="checkbox"
                      checked={hand.enabled}
                      onChange={(event) => {
                        void handleToggle(hand, event.currentTarget.checked);
                      }}
                      disabled={savingId === hand.id}
                      className="h-4 w-4 accent-[#6c5ce7]"
                    />
                    {hand.enabled ? "Enabled" : "Disabled"}
                  </label>
                  <Link href={`/dashboard/hands/${hand.id}`} className="text-xs font-medium text-[#a29bfe] hover:text-[#b9b3ff]">
                    View details
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>

        {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}
      </div>
    </div>
  );
}
