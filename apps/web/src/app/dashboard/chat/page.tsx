"use client";

import Link from "next/link";
import { signIn, useSession } from "next-auth/react";
import { useEffect, useState } from "react";

type TenantStatus = "active" | "paused" | "suspended" | string;

export default function ChatPage() {
  const { data: session, status: authStatus } = useSession();
  const [tenantStatus, setTenantStatus] = useState<TenantStatus>("active");
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [input, setInput] = useState("");

  useEffect(() => {
    if (authStatus !== "authenticated") {
      setLoadingStatus(false);
      return;
    }

    let cancelled = false;
    const loadStatus = async () => {
      try {
        const res = await fetch("/api/tenant/status", { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`status fetch failed: ${res.status}`);
        }
        const data = (await res.json()) as { status: TenantStatus };
        if (!cancelled) {
          setTenantStatus(data.status);
        }
      } catch {
        if (!cancelled) {
          setTenantStatus("active");
        }
      } finally {
        if (!cancelled) {
          setLoadingStatus(false);
        }
      }
    };

    loadStatus();

    return () => {
      cancelled = true;
    };
  }, [authStatus]);

  if (authStatus === "loading" || loadingStatus) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl items-center justify-center px-4 py-12">
        <p className="text-text2">Loading chat...</p>
      </main>
    );
  }

  if (!session || authStatus !== "authenticated") {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl items-center justify-center px-4 py-12">
        <div className="space-y-4 rounded-xl border border-bg3 bg-bg2 p-8 text-center">
          <h1 className="text-xl font-semibold">Sign in to access chat</h1>
          <button
            onClick={() => signIn(undefined, { callbackUrl: "/dashboard/chat" })}
            className="rounded-lg bg-accent px-4 py-2 font-medium text-white transition-opacity hover:opacity-90"
          >
            Sign In
          </button>
        </div>
      </main>
    );
  }

  const isPaused = tenantStatus === "paused";

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Chat</h1>
        <p className="text-sm text-text2">Tenant: {session.user.tenantId}</p>
      </div>

      <div className="relative rounded-xl border border-bg3 bg-bg2 p-4">
        <div className="mb-4 h-[420px] rounded-lg border border-bg3 bg-bg p-4 text-text2">
          Conversation history will appear here.
        </div>

        <div className="flex gap-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isPaused ? "Top up credits to continue" : "Type a message..."}
            disabled={isPaused}
            className="flex-1 rounded-lg border border-bg3 bg-bg px-4 py-2.5 text-text placeholder-text2 focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="button"
            disabled={isPaused || input.trim().length === 0}
            className="rounded-lg bg-accent px-5 py-2.5 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </div>

        {isPaused && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-bg/85 p-6 text-center">
            <div className="max-w-sm space-y-4 rounded-lg border border-bg3 bg-bg2 p-6">
              <p className="text-lg font-semibold">Credits exhausted — top up to continue</p>
              <Link
                href="/dashboard/billing"
                className="inline-block rounded-lg bg-accent px-4 py-2 font-medium text-white transition-opacity hover:opacity-90"
              >
                Buy Credits
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
