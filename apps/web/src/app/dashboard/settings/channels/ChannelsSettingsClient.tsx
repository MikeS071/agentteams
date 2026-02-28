"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type SupportedChannel = "telegram" | "whatsapp" | "web";

type ChannelState = {
  channel: SupportedChannel;
  status: "connected" | "disconnected";
  channelUserId: string | null;
  linkedAt: string | null;
  lastMessageAt: string | null;
  notificationsEnabled: boolean;
  autoReplyEnabled: boolean;
  connectionDetails: string;
  webchatSnippet: string | null;
};

type ApiResponse = {
  channels: ChannelState[];
};

const CHANNEL_ORDER: SupportedChannel[] = ["telegram", "whatsapp", "web"];

const CHANNEL_META: Record<SupportedChannel, { label: string; description: string }> = {
  telegram: {
    label: "Telegram",
    description: "Connect a Telegram bot token to receive and send messages.",
  },
  whatsapp: {
    label: "WhatsApp",
    description: "Link a phone number and pair this tenant to your WhatsApp channel.",
  },
  web: {
    label: "Webchat",
    description: "Embed the chat widget on your site with the generated snippet.",
  },
};

function formatDateTime(value: string | null): string {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleString();
}

export default function ChannelsSettingsClient() {
  const [channels, setChannels] = useState<ChannelState[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyChannel, setBusyChannel] = useState<SupportedChannel | null>(null);

  const [telegramToken, setTelegramToken] = useState("");
  const [whatsAppPhone, setWhatsAppPhone] = useState("");

  const sortedChannels = useMemo(() => {
    const byId = new Map(channels.map((channel) => [channel.channel, channel]));
    return CHANNEL_ORDER.map((id) => byId.get(id)).filter((row): row is ChannelState => !!row);
  }, [channels]);

  const refreshChannels = useCallback(async (showLoader: boolean) => {
    try {
      if (showLoader) {
        setIsLoading(true);
      }

      const response = await fetch("/api/channels/settings", {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Failed to load channel settings");
      }

      const json = (await response.json()) as ApiResponse;
      setChannels(json.channels ?? []);
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Failed to load channel settings");
    } finally {
      if (showLoader) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshChannels(true);
  }, [refreshChannels]);

  useEffect(() => {
    const interval = setInterval(() => {
      void refreshChannels(false);
    }, 10000);

    return () => clearInterval(interval);
  }, [refreshChannels]);

  async function connectChannel(channel: SupportedChannel) {
    try {
      setBusyChannel(channel);

      const payload: Record<string, string> = { channel };
      if (channel === "telegram") {
        payload.botToken = telegramToken;
      }
      if (channel === "whatsapp") {
        payload.phoneNumber = whatsAppPhone;
      }

      const response = await fetch("/api/channels/connection", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const json = (await response.json()) as { error?: string };
        throw new Error(json.error ?? "Failed to connect channel");
      }

      await refreshChannels(false);
      setTelegramToken("");
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Failed to connect channel");
    } finally {
      setBusyChannel(null);
    }
  }

  async function disconnectChannel(channel: SupportedChannel) {
    if (!window.confirm(`Disconnect ${CHANNEL_META[channel].label}?`)) {
      return;
    }

    try {
      setBusyChannel(channel);

      const response = await fetch("/api/channels/connection", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel }),
      });

      if (!response.ok) {
        const json = (await response.json()) as { error?: string };
        throw new Error(json.error ?? "Failed to disconnect channel");
      }

      await refreshChannels(false);
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Failed to disconnect channel");
    } finally {
      setBusyChannel(null);
    }
  }

  async function updatePreference(channel: SupportedChannel, key: "notificationsEnabled" | "autoReplyEnabled", value: boolean) {
    try {
      setBusyChannel(channel);

      const response = await fetch("/api/channels/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel, [key]: value }),
      });

      if (!response.ok) {
        const json = (await response.json()) as { error?: string };
        throw new Error(json.error ?? "Failed to update settings");
      }

      setChannels((current) =>
        current.map((item) => {
          if (item.channel !== channel) {
            return item;
          }
          return { ...item, [key]: value };
        })
      );
    } catch (preferenceError) {
      setError(preferenceError instanceof Error ? preferenceError.message : "Failed to update settings");
    } finally {
      setBusyChannel(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-[#0a0a0f] px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-5xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-100">Channel Management</h1>
          <p className="mt-1 text-sm text-gray-400">
            Connect Telegram, WhatsApp, and Webchat channels with per-channel notification and auto-reply settings.
          </p>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
        ) : null}

        {isLoading ? <div className="text-sm text-gray-400">Loading channels...</div> : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {sortedChannels.map((channel) => {
            const meta = CHANNEL_META[channel.channel];
            const isBusy = busyChannel === channel.channel;
            const isConnected = channel.status === "connected";
            const pairingCode = (whatsAppPhone.trim() || "PAIR-ME").replace(/\s+/g, "").toUpperCase();

            return (
              <section
                key={channel.channel}
                className="rounded-xl border border-[#1f1f30] bg-[#11111a] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-medium text-gray-100">{meta.label}</h2>
                    <p className="mt-1 text-sm text-gray-400">{meta.description}</p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      isConnected
                        ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                        : "border border-gray-600/50 bg-[#1b1b2a] text-gray-300"
                    }`}
                  >
                    {isConnected ? "Connected" : "Disconnected"}
                  </span>
                </div>

                <div className="mt-4 space-y-2 text-sm">
                  <p className="text-gray-300">Connection: {channel.connectionDetails}</p>
                  <p className="text-gray-400">Linked: {formatDateTime(channel.linkedAt)}</p>
                  <p className="text-gray-400">Last message: {formatDateTime(channel.lastMessageAt)}</p>
                </div>

                {channel.channel === "telegram" && !isConnected ? (
                  <div className="mt-4 space-y-2">
                    <input
                      value={telegramToken}
                      onChange={(event) => setTelegramToken(event.target.value)}
                      type="password"
                      placeholder="Telegram bot token"
                      className="w-full rounded-md border border-[#32324a] bg-[#0f0f17] px-3 py-2 text-sm text-gray-100 outline-none ring-[#6c5ce7] focus:ring-2"
                    />
                    <button
                      onClick={() => void connectChannel("telegram")}
                      disabled={isBusy || telegramToken.trim().length === 0}
                      className="inline-flex items-center rounded-md bg-[#6c5ce7] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Verify and connect
                    </button>
                  </div>
                ) : null}

                {channel.channel === "whatsapp" && !isConnected ? (
                  <div className="mt-4 space-y-3">
                    <input
                      value={whatsAppPhone}
                      onChange={(event) => setWhatsAppPhone(event.target.value)}
                      type="text"
                      placeholder="Phone number (E.164)"
                      className="w-full rounded-md border border-[#32324a] bg-[#0f0f17] px-3 py-2 text-sm text-gray-100 outline-none ring-[#6c5ce7] focus:ring-2"
                    />
                    <div className="rounded-lg border border-[#2a2a3f] bg-[#0f0f16] p-3">
                      <p className="text-xs text-gray-400">Pairing code</p>
                      <p className="mt-2 inline-flex rounded border border-[#2f2f46] bg-[#0b0b12] px-2 py-1 font-mono text-xs text-gray-200">
                        {pairingCode}
                      </p>
                    </div>
                    <button
                      onClick={() => void connectChannel("whatsapp")}
                      disabled={isBusy || whatsAppPhone.trim().length === 0}
                      className="inline-flex items-center rounded-md bg-[#6c5ce7] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Link phone number
                    </button>
                  </div>
                ) : null}

                {channel.channel === "web" ? (
                  <div className="mt-4 space-y-2">
                    <textarea
                      readOnly
                      value={channel.webchatSnippet ?? ""}
                      rows={4}
                      className="w-full rounded-md border border-[#32324a] bg-[#0f0f17] px-3 py-2 font-mono text-xs text-gray-200"
                    />
                    {!isConnected ? (
                      <button
                        onClick={() => void connectChannel("web")}
                        disabled={isBusy}
                        className="inline-flex items-center rounded-md bg-[#6c5ce7] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Enable webchat
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-4 space-y-2 rounded-lg border border-[#2a2a3f] bg-[#10101a] p-3">
                  <label className="flex items-center justify-between gap-2 text-sm text-gray-300">
                    <span>Notifications</span>
                    <input
                      type="checkbox"
                      checked={channel.notificationsEnabled}
                      onChange={(event) =>
                        void updatePreference(channel.channel, "notificationsEnabled", event.target.checked)
                      }
                      disabled={isBusy}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2 text-sm text-gray-300">
                    <span>Auto-reply</span>
                    <input
                      type="checkbox"
                      checked={channel.autoReplyEnabled}
                      onChange={(event) =>
                        void updatePreference(channel.channel, "autoReplyEnabled", event.target.checked)
                      }
                      disabled={isBusy}
                    />
                  </label>
                </div>

                {isConnected ? (
                  <button
                    onClick={() => void disconnectChannel(channel.channel)}
                    disabled={isBusy}
                    className="mt-4 inline-flex items-center rounded-md border border-[#3a3a52] px-3 py-2 text-sm font-medium text-gray-200 hover:bg-[#1a1a28] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Disconnect
                  </button>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
