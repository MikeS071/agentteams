"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type ChannelRecord = {
  id: string;
  channel: "telegram" | "whatsapp" | "web";
  status: string;
  enabled: boolean;
  message_count: number;
  linked_at?: string;
  updated_at?: string;
  credentials?: Record<string, unknown>;
};

type ChannelsResponse = {
  channels?: ChannelRecord[];
};

function hasChannels(payload: unknown): payload is ChannelsResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  return "channels" in payload;
}

function statusTone(enabled: boolean) {
  return enabled
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
    : "border-gray-500/30 bg-gray-500/10 text-gray-300";
}

function channelLabel(channel: ChannelRecord["channel"]) {
  if (channel === "telegram") return "Telegram";
  if (channel === "whatsapp") return "WhatsApp";
  return "Web";
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const maybeError = (payload as Record<string, unknown>).error;
  if (typeof maybeError === "string" && maybeError.trim()) {
    return maybeError;
  }

  const details = (payload as Record<string, unknown>).details;
  if (typeof details === "string" && details.trim()) {
    return details;
  }

  return fallback;
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramLoading, setTelegramLoading] = useState(false);

  const [waAccessToken, setWaAccessToken] = useState("");
  const [waPhoneNumberID, setWaPhoneNumberID] = useState("");
  const [waBusinessAccountID, setWaBusinessAccountID] = useState("");
  const [waApiVersion, setWaApiVersion] = useState("v20.0");
  const [whatsappLoading, setWhatsAppLoading] = useState(false);

  const telegramConnected = useMemo(
    () => channels.some((item) => item.channel === "telegram" && item.enabled),
    [channels]
  );
  const whatsappConnected = useMemo(
    () => channels.some((item) => item.channel === "whatsapp" && item.enabled),
    [channels]
  );

  const loadChannels = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/channels", { cache: "no-store" });
      const payload = (await res.json().catch(() => ({}))) as unknown;
      if (!res.ok) {
        throw new Error(getErrorMessage(payload, "Failed to load channels"));
      }

      const records = hasChannels(payload) && Array.isArray(payload.channels)
        ? payload.channels.filter((item): item is ChannelRecord => Boolean(item && typeof item.id === "string"))
        : [];
      setChannels(records);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channels");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  async function connectTelegram(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTelegramLoading(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/channels/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: telegramBotToken }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string; details?: string };
      if (!res.ok) {
        throw new Error(getErrorMessage(payload, "Telegram connection failed"));
      }

      setTelegramBotToken("");
      setNotice("Telegram bot verified, webhook configured, and channel enabled.");
      await loadChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Telegram connection failed");
    } finally {
      setTelegramLoading(false);
    }
  }

  async function connectWhatsApp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWhatsAppLoading(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/channels/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: waAccessToken,
          phoneNumberId: waPhoneNumberID,
          businessAccountId: waBusinessAccountID,
          apiVersion: waApiVersion,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string; details?: string };
      if (!res.ok) {
        throw new Error(getErrorMessage(payload, "WhatsApp connection failed"));
      }

      setNotice("WhatsApp credentials verified and channel enabled.");
      await loadChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "WhatsApp connection failed");
    } finally {
      setWhatsAppLoading(false);
    }
  }

  async function disconnectChannel(id: string) {
    setError(null);
    setNotice(null);

    const res = await fetch(`/api/channels?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });

    if (!res.ok && res.status !== 204) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string; details?: string };
      setError(getErrorMessage(payload, "Failed to disconnect channel"));
      return;
    }

    setNotice("Channel disconnected.");
    await loadChannels();
  }

  return (
    <div className="h-full overflow-y-auto bg-[#0b0b11] p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="rounded-2xl border border-[#25253a] bg-[#11111a] p-5">
          <h1 className="text-xl font-semibold text-gray-100">Channels</h1>
          <p className="mt-1 text-sm text-gray-400">Connect Telegram and WhatsApp to sync channel messages with your webchat assistant.</p>
          {error && <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
          {notice && <p className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{notice}</p>}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-[#24243a] bg-[#101018] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-100">Connect Telegram</h2>
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusTone(telegramConnected)}`}>
                {telegramConnected ? "Connected" : "Not connected"}
              </span>
            </div>
            <form onSubmit={connectTelegram} className="space-y-3">
              <label className="block text-xs font-medium uppercase tracking-wide text-gray-400" htmlFor="telegram-token">
                Bot token
              </label>
              <input
                id="telegram-token"
                type="password"
                value={telegramBotToken}
                onChange={(event) => setTelegramBotToken(event.target.value)}
                placeholder="123456:AA..."
                className="w-full rounded-lg border border-[#2a2a40] bg-[#0b0b12] px-3 py-2 text-sm text-gray-100 outline-none ring-0 placeholder:text-gray-500 focus:border-[#3a3a5d]"
                required
              />
              <button
                type="submit"
                disabled={telegramLoading}
                className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {telegramLoading ? "Testing..." : "Test Connection + Enable"}
              </button>
            </form>
          </section>

          <section className="rounded-2xl border border-[#24243a] bg-[#101018] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-100">Connect WhatsApp</h2>
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusTone(whatsappConnected)}`}>
                {whatsappConnected ? "Connected" : "Not connected"}
              </span>
            </div>
            <form onSubmit={connectWhatsApp} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400" htmlFor="wa-token">
                  Access token
                </label>
                <input
                  id="wa-token"
                  type="password"
                  value={waAccessToken}
                  onChange={(event) => setWaAccessToken(event.target.value)}
                  className="w-full rounded-lg border border-[#2a2a40] bg-[#0b0b12] px-3 py-2 text-sm text-gray-100 outline-none placeholder:text-gray-500 focus:border-[#3a3a5d]"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400" htmlFor="wa-phone-number-id">
                  Phone number ID
                </label>
                <input
                  id="wa-phone-number-id"
                  type="text"
                  value={waPhoneNumberID}
                  onChange={(event) => setWaPhoneNumberID(event.target.value)}
                  className="w-full rounded-lg border border-[#2a2a40] bg-[#0b0b12] px-3 py-2 text-sm text-gray-100 outline-none placeholder:text-gray-500 focus:border-[#3a3a5d]"
                  required
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400" htmlFor="wa-business-account-id">
                    Business account ID
                  </label>
                  <input
                    id="wa-business-account-id"
                    type="text"
                    value={waBusinessAccountID}
                    onChange={(event) => setWaBusinessAccountID(event.target.value)}
                    className="w-full rounded-lg border border-[#2a2a40] bg-[#0b0b12] px-3 py-2 text-sm text-gray-100 outline-none placeholder:text-gray-500 focus:border-[#3a3a5d]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400" htmlFor="wa-api-version">
                    API version
                  </label>
                  <input
                    id="wa-api-version"
                    type="text"
                    value={waApiVersion}
                    onChange={(event) => setWaApiVersion(event.target.value)}
                    placeholder="v20.0"
                    className="w-full rounded-lg border border-[#2a2a40] bg-[#0b0b12] px-3 py-2 text-sm text-gray-100 outline-none placeholder:text-gray-500 focus:border-[#3a3a5d]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={whatsappLoading}
                className="rounded-lg bg-[#16a34a] px-4 py-2 text-sm font-medium text-white hover:bg-[#15803d] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {whatsappLoading ? "Verifying..." : "Verify + Enable"}
              </button>
            </form>
          </section>
        </div>

        <section className="rounded-2xl border border-[#24243a] bg-[#101018] p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-100">Connected Channels</h2>
            <button
              type="button"
              onClick={() => void loadChannels()}
              className="rounded-md border border-[#2a2a40] bg-[#171724] px-2.5 py-1 text-xs text-gray-300 hover:bg-[#1d1d2e]"
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-gray-400">Loading channels...</p>
          ) : channels.length === 0 ? (
            <p className="text-sm text-gray-500">No channel connections yet.</p>
          ) : (
            <div className="space-y-3">
              {channels.map((item) => (
                <div key={item.id} className="rounded-xl border border-[#2a2a40] bg-[#131320] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-gray-100">{channelLabel(item.channel)}</p>
                      <p className="text-xs text-gray-400">Messages: {item.message_count}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusTone(item.enabled)}`}>
                        {item.status}
                      </span>
                      {item.channel !== "web" && (
                        <button
                          type="button"
                          onClick={() => void disconnectChannel(item.id)}
                          className="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/20"
                        >
                          Disconnect
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
