"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type TelegramStatus = {
  connected: boolean;
  botUsername?: string | null;
  channelUserId?: string | null;
};

export default function SettingsPage() {
  const [botToken, setBotToken] = useState("");
  const [status, setStatus] = useState<TelegramStatus>({ connected: false });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadStatus() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/channels/telegram", { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to load Telegram status");
      }
      setStatus({
        connected: !!payload.connected,
        botUsername: payload.botUsername,
        channelUserId: payload.channelUserId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Telegram status");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function connectTelegram(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/channels/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to connect Telegram");
      }
      setBotToken("");
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect Telegram");
    } finally {
      setSubmitting(false);
    }
  }

  async function disconnectTelegram() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/channels/telegram", { method: "DELETE" });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to disconnect Telegram");
      }
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect Telegram");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-[#0a0a0f] px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-100">Settings</h1>
          <p className="mt-1 text-sm text-gray-400">Manage workspace integrations and preferences.</p>
        </div>

        <section className="rounded-xl border border-[#1f1f30] bg-[#11111a] p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-medium text-gray-100">Telegram Bot</h2>
              <p className="mt-1 text-sm text-gray-400">
                Status:{" "}
                <span className={status.connected ? "text-emerald-300" : "text-gray-300"}>
                  {loading ? "Loading..." : status.connected ? "Connected" : "Disconnected"}
                </span>
              </p>
              {status.connected && status.botUsername ? (
                <p className="mt-1 text-sm text-gray-300">@{status.botUsername}</p>
              ) : null}
              {status.connected && status.channelUserId ? (
                <p className="mt-1 text-xs text-gray-500">Last chat ID: {status.channelUserId}</p>
              ) : null}
            </div>

            <form onSubmit={connectTelegram} className="w-full max-w-md space-y-2">
              <input
                type="password"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="Telegram bot token"
                className="w-full rounded-md border border-[#2c2c42] bg-[#0d0d15] px-3 py-2 text-sm text-gray-100 outline-none focus:border-[#6c5ce7]"
                disabled={submitting}
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="inline-flex items-center rounded-md bg-[#6c5ce7] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                  disabled={submitting || botToken.trim().length === 0}
                >
                  Connect
                </button>
                <button
                  type="button"
                  onClick={disconnectTelegram}
                  className="inline-flex items-center rounded-md border border-[#3a3a52] px-3 py-2 text-sm font-medium text-gray-200 hover:bg-[#1a1a28] disabled:opacity-60"
                  disabled={submitting || !status.connected}
                >
                  Disconnect
                </button>
              </div>
            </form>
          </div>

          {error ? (
            <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border border-[#1f1f30] bg-[#11111a] p-5">
          <h2 className="text-lg font-medium text-gray-100">Deployment Integrations</h2>
          <p className="mt-1 text-sm text-gray-400">
            Manage Vercel and Supabase OAuth connections in the deploy settings view.
          </p>
          <Link
            href="/dashboard/settings/deploy"
            className="mt-4 inline-flex rounded-md bg-[#6c5ce7] px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Open Deploy Settings
          </Link>
        </section>
      </div>
    </div>
  );
}
