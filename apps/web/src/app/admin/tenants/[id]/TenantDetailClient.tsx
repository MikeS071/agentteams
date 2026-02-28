"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useEffect } from "react";

type UsageByModelRow = {
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  revenue_cents: number;
  last_used_at?: string | null;
};

type CreditHistoryRow = {
  id?: string;
  created_at?: string;
  amount_cents: number;
  reason: string;
  admin_email?: string | null;
};

type TenantDetail = {
  id: string;
  user_id?: string;
  email?: string | null;
  status: string;
  container_id?: string | null;
  container?: {
    id?: string;
    state?: string;
    running?: boolean;
    health?: string;
    started_at?: string | null;
    memory_mb?: number;
    cpu_pct?: number;
  };
  credits_balance_cents?: number;
  created_at?: string;
  usage?: {
    total_input_tokens?: number;
    total_output_tokens?: number;
    total_tokens?: number;
    total_revenue_cents?: number;
    tokens_today?: number;
    tokens_week?: number;
    tokens_month?: number;
    by_model?: UsageByModelRow[];
  };
  credit_history?: CreditHistoryRow[];
  container_logs?: string[];
};

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

type Props = {
  tenantId: string;
};

export default function TenantDetailClient({ tenantId }: Props) {
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("10");
  const [adjustReason, setAdjustReason] = useState("Manual admin adjustment");
  const [adjustPending, setAdjustPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadTenant() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/admin/tenants/${tenantId}`, { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as
          | { tenant?: TenantDetail; error?: string }
          | null;

        if (!response.ok) {
          throw new Error(payload?.error ?? "Failed to load tenant");
        }

        if (mounted) {
          setTenant(payload?.tenant ?? null);
        }
      } catch (requestError) {
        if (mounted) {
          setError(requestError instanceof Error ? requestError.message : "Failed to load tenant");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadTenant();
    return () => {
      mounted = false;
    };
  }, [tenantId]);

  const usageByModel = useMemo(() => {
    if (!tenant?.usage?.by_model) {
      return [];
    }
    return [...tenant.usage.by_model].sort((a, b) => (b.total_tokens ?? 0) - (a.total_tokens ?? 0));
  }, [tenant]);

  const creditHistory = tenant?.credit_history ?? [];

  const containerLogs = useMemo(() => {
    if (tenant?.container_logs && tenant.container_logs.length > 0) {
      return tenant.container_logs;
    }

    const fallback: string[] = [];
    if (tenant?.created_at) {
      fallback.push(`[${new Date(tenant.created_at).toISOString()}] Tenant created`);
    }
    if (tenant?.container?.started_at) {
      fallback.push(`[${new Date(tenant.container.started_at).toISOString()}] Container started`);
    }
    if (tenant?.container?.state) {
      fallback.push(`[${new Date().toISOString()}] Container state: ${tenant.container.state}`);
    }

    return fallback;
  }, [tenant]);

  async function handleAdjustCredits(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    const amountUsd = Number(adjustAmount);
    if (!Number.isFinite(amountUsd) || amountUsd === 0) {
      setError("Amount must be a non-zero number");
      return;
    }

    const amountCents = Math.round(amountUsd * 100);
    if (amountCents === 0) {
      setError("Amount is too small after cents conversion");
      return;
    }

    const reason = adjustReason.trim();
    if (!reason) {
      setError("Reason is required");
      return;
    }

    setAdjustPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/tenants/${tenantId}/credits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents, reason }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { balance_cents?: number; updated_at?: string; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to adjust credits");
      }

      setTenant((prev) => {
        if (!prev) return prev;

        const nextHistory: CreditHistoryRow[] = [
          {
            id: `manual-${Date.now()}`,
            created_at: payload?.updated_at ?? new Date().toISOString(),
            amount_cents: amountCents,
            reason,
            admin_email: "current-admin",
          },
          ...(prev.credit_history ?? []),
        ];

        return {
          ...prev,
          credits_balance_cents: payload?.balance_cents ?? prev.credits_balance_cents,
          credit_history: nextHistory,
        };
      });

      setNotice("Credits updated successfully.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to adjust credits");
    } finally {
      setAdjustPending(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-400">Loading tenant details...</p>;
  }

  if (error || !tenant) {
    return (
      <div className="rounded-xl border border-red-900/60 bg-red-950/20 p-4 text-sm text-red-200">
        {error ?? "Tenant not found."}
      </div>
    );
  }

  const usage = tenant.usage ?? {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Tenant Detail</p>
          <h1 className="text-2xl font-semibold text-white">{tenant.email || tenant.id}</h1>
        </div>
        <Link href="/admin/tenants" className="rounded-md border border-[#3f3f62] px-3 py-2 text-sm text-gray-200">
          Back to Tenants
        </Link>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Status</p>
          <p className="mt-2 text-lg font-semibold text-white">{tenant.status}</p>
          <p className="mt-1 text-xs text-gray-400">Container: {tenant.container?.state || "not_provisioned"}</p>
        </article>
        <article className="rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Credit Balance</p>
          <p className="mt-2 text-lg font-semibold text-emerald-300">{formatCurrency(tenant.credits_balance_cents ?? 0)}</p>
          <p className="mt-1 text-xs text-gray-400">Tenant ID: {tenant.id}</p>
        </article>
        <article className="rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Total Tokens</p>
          <p className="mt-2 text-lg font-semibold text-white">{formatNumber(usage.total_tokens ?? 0)}</p>
          <p className="mt-1 text-xs text-gray-400">Input {formatNumber(usage.total_input_tokens ?? 0)} / Output {formatNumber(usage.total_output_tokens ?? 0)}</p>
        </article>
        <article className="rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Revenue</p>
          <p className="mt-2 text-lg font-semibold text-emerald-300">{formatCurrency(usage.total_revenue_cents ?? 0)}</p>
          <p className="mt-1 text-xs text-gray-400">Today {formatNumber(usage.tokens_today ?? 0)} tokens</p>
        </article>
      </section>

      <section className="rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">Usage Breakdown by Model</h2>
        <div className="overflow-x-auto rounded-lg border border-[#1d1d2c]">
          <table className="min-w-full text-sm text-gray-300">
            <thead className="bg-[#0f0f18] text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Input Tokens</th>
                <th className="px-3 py-2">Output Tokens</th>
                <th className="px-3 py-2">Total Tokens</th>
                <th className="px-3 py-2">Revenue</th>
                <th className="px-3 py-2">Last Used</th>
              </tr>
            </thead>
            <tbody>
              {usageByModel.map((row) => (
                <tr key={row.model} className="border-t border-[#1d1d2c]">
                  <td className="px-3 py-2 text-white">{row.model}</td>
                  <td className="px-3 py-2">{formatNumber(row.input_tokens ?? 0)}</td>
                  <td className="px-3 py-2">{formatNumber(row.output_tokens ?? 0)}</td>
                  <td className="px-3 py-2">{formatNumber(row.total_tokens ?? 0)}</td>
                  <td className="px-3 py-2 text-emerald-300">{formatCurrency(row.revenue_cents ?? 0)}</td>
                  <td className="px-3 py-2">{formatDateTime(row.last_used_at)}</td>
                </tr>
              ))}
              {usageByModel.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                    No usage data yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4">
          <h2 className="mb-3 text-lg font-semibold text-white">Credit History</h2>
          <div className="overflow-x-auto rounded-lg border border-[#1d1d2c]">
            <table className="min-w-full text-sm text-gray-300">
              <thead className="bg-[#0f0f18] text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">Admin</th>
                </tr>
              </thead>
              <tbody>
                {creditHistory.map((row) => (
                  <tr key={row.id ?? `${row.created_at}-${row.reason}`} className="border-t border-[#1d1d2c]">
                    <td className="px-3 py-2">{formatDateTime(row.created_at)}</td>
                    <td className={`px-3 py-2 ${row.amount_cents >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                      {row.amount_cents >= 0 ? "+" : ""}
                      {formatCurrency(row.amount_cents)}
                    </td>
                    <td className="px-3 py-2">{row.reason}</td>
                    <td className="px-3 py-2">{row.admin_email || "-"}</td>
                  </tr>
                ))}
                {creditHistory.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                      No credit history returned by the admin API yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4">
          <h2 className="mb-3 text-lg font-semibold text-white">Container Logs</h2>
          <div className="max-h-80 overflow-auto rounded-lg border border-[#1d1d2c] bg-[#0b0b12] p-3 font-mono text-xs text-gray-300">
            {containerLogs.length > 0 ? (
              <pre className="whitespace-pre-wrap">{containerLogs.join("\n")}</pre>
            ) : (
              <p className="text-gray-500">No container logs returned by the admin API yet.</p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">Manual Credit Adjustment</h2>
        <form onSubmit={handleAdjustCredits} className="grid gap-3 md:grid-cols-[1fr_2fr_auto]">
          <input
            type="number"
            step="0.01"
            value={adjustAmount}
            onChange={(event) => setAdjustAmount(event.target.value)}
            placeholder="Amount in USD"
            className="rounded-md border border-[#27273a] bg-[#0d0d14] px-3 py-2 text-sm text-gray-100"
          />
          <input
            type="text"
            value={adjustReason}
            onChange={(event) => setAdjustReason(event.target.value)}
            placeholder="Reason"
            className="rounded-md border border-[#27273a] bg-[#0d0d14] px-3 py-2 text-sm text-gray-100"
          />
          <button
            type="submit"
            disabled={adjustPending}
            className="rounded-md bg-[#2d6cdf] px-4 py-2 text-sm font-medium text-white hover:bg-[#2258b7] disabled:opacity-60"
          >
            {adjustPending ? "Applying..." : "Apply"}
          </button>
        </form>

        {notice && <p className="mt-3 text-sm text-emerald-300">{notice}</p>}
      </section>
    </div>
  );
}
