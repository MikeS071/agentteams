"use client";

import { useEffect, useMemo, useState } from "react";

type StatsPayload = {
  total_tenants: number;
  active_tenants: number;
  active_containers: number;
  tokens?: {
    today: number;
    week: number;
    month: number;
  };
  revenue_estimate_cents?: {
    today: number;
    week: number;
    month: number;
  };
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export default function AdminDashboardClient() {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadStats() {
      try {
        const response = await fetch("/api/admin/stats", { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as
          | StatsPayload
          | { error?: string }
          | null;

        if (!response.ok) {
          throw new Error(payload && "error" in payload ? payload.error ?? "Failed to load stats" : "Failed to load stats");
        }

        if (mounted) {
          setStats(payload as StatsPayload);
          setError(null);
        }
      } catch (requestError) {
        if (!mounted) {
          return;
        }
        setError(requestError instanceof Error ? requestError.message : "Failed to load stats");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadStats();
    return () => {
      mounted = false;
    };
  }, []);

  const revenuePerToken = useMemo(() => {
    if (!stats?.tokens?.month || !stats?.revenue_estimate_cents?.month) {
      return 0;
    }

    if (stats.tokens.month <= 0) {
      return 0;
    }

    return stats.revenue_estimate_cents.month / stats.tokens.month;
  }, [stats]);

  if (loading) {
    return <div className="p-6 text-sm text-gray-400">Loading platform stats...</div>;
  }

  if (error || !stats) {
    return (
      <div className="rounded-xl border border-red-900/60 bg-red-950/20 p-4 text-sm text-red-200">
        {error ?? "Unable to load platform stats."}
      </div>
    );
  }

  const tokens = stats.tokens ?? { today: 0, week: 0, month: 0 };
  const revenue = stats.revenue_estimate_cents ?? { today: 0, week: 0, month: 0 };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-white">Platform Overview</h1>
        <p className="mt-1 text-sm text-gray-400">Operational stats and revenue estimate from token usage.</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Total Tenants</p>
          <p className="mt-2 text-2xl font-semibold text-white">{formatNumber(stats.total_tenants)}</p>
        </article>
        <article className="rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Active Tenants</p>
          <p className="mt-2 text-2xl font-semibold text-white">{formatNumber(stats.active_tenants)}</p>
        </article>
        <article className="rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Active Containers</p>
          <p className="mt-2 text-2xl font-semibold text-white">{formatNumber(stats.active_containers)}</p>
        </article>
        <article className="rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Revenue / Token (30d)</p>
          <p className="mt-2 text-2xl font-semibold text-white">{(revenuePerToken / 100).toFixed(6)} USD</p>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4">
          <h2 className="text-lg font-semibold text-white">Token Volume</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[#27273a] bg-[#0f0f18] p-3">
              <p className="text-xs uppercase text-gray-500">Today</p>
              <p className="mt-1 text-xl font-semibold text-white">{formatNumber(tokens.today)}</p>
            </div>
            <div className="rounded-lg border border-[#27273a] bg-[#0f0f18] p-3">
              <p className="text-xs uppercase text-gray-500">7 Days</p>
              <p className="mt-1 text-xl font-semibold text-white">{formatNumber(tokens.week)}</p>
            </div>
            <div className="rounded-lg border border-[#27273a] bg-[#0f0f18] p-3">
              <p className="text-xs uppercase text-gray-500">30 Days</p>
              <p className="mt-1 text-xl font-semibold text-white">{formatNumber(tokens.month)}</p>
            </div>
          </div>
        </article>

        <article className="rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4">
          <h2 className="text-lg font-semibold text-white">Revenue Estimate (Tokens x Pricing)</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[#27273a] bg-[#0f0f18] p-3">
              <p className="text-xs uppercase text-gray-500">Today</p>
              <p className="mt-1 text-xl font-semibold text-emerald-300">{formatUsd(revenue.today)}</p>
            </div>
            <div className="rounded-lg border border-[#27273a] bg-[#0f0f18] p-3">
              <p className="text-xs uppercase text-gray-500">7 Days</p>
              <p className="mt-1 text-xl font-semibold text-emerald-300">{formatUsd(revenue.week)}</p>
            </div>
            <div className="rounded-lg border border-[#27273a] bg-[#0f0f18] p-3">
              <p className="text-xs uppercase text-gray-500">30 Days</p>
              <p className="mt-1 text-xl font-semibold text-emerald-300">{formatUsd(revenue.month)}</p>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
