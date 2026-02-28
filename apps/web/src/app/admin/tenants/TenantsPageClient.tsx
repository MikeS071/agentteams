"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type TenantContainer = {
  id?: string;
  state?: string;
  running?: boolean;
  health?: string;
  started_at?: string | null;
};

type TenantUsage = {
  total_tokens?: number;
  tokens_24h?: number;
};

type TenantRow = {
  id: string;
  email?: string | null;
  status: string;
  credits_balance_cents?: number;
  created_at?: string;
  container?: TenantContainer;
  usage?: TenantUsage;
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatDollarsFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function displayName(tenant: TenantRow): string {
  const email = tenant.email?.trim();
  if (email) {
    return email.split("@")[0] || email;
  }
  return `tenant-${tenant.id.slice(0, 8)}`;
}

function containerState(tenant: TenantRow): string {
  return tenant.container?.state || "not_provisioned";
}

function lastActiveLabel(tenant: TenantRow): string {
  if (tenant.container?.started_at) {
    return formatDateTime(tenant.container.started_at);
  }

  const recentTokens = tenant.usage?.tokens_24h ?? 0;
  if (recentTokens > 0) {
    return "Active in last 24h";
  }

  return formatDateTime(tenant.created_at);
}

export default function TenantsPageClient() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyByTenant, setBusyByTenant] = useState<Record<string, boolean>>({});

  const loadTenants = useCallback(async (search = "") => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (search.trim()) {
        params.set("q", search.trim());
      }

      const path = params.toString() ? `/api/admin/tenants?${params.toString()}` : "/api/admin/tenants";
      const response = await fetch(path, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | { tenants?: TenantRow[]; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to load tenants");
      }

      setTenants(Array.isArray(payload?.tenants) ? payload!.tenants! : []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to load tenants");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  const orderedTenants = useMemo(() => {
    return [...tenants].sort((a, b) => (a.email ?? "").localeCompare(b.email ?? "") || a.id.localeCompare(b.id));
  }, [tenants]);

  async function toggleTenantStatus(tenant: TenantRow) {
    const action = tenant.status === "suspended" ? "resume" : "suspend";
    setBusyByTenant((prev) => ({ ...prev, [tenant.id]: true }));
    setError(null);

    try {
      const response = await fetch(`/api/admin/tenants/${tenant.id}/${action}`, {
        method: "POST",
      });

      const payload = (await response.json().catch(() => null)) as
        | { status?: string; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? `Failed to ${action} tenant`);
      }

      const nextStatus = payload?.status ?? (action === "resume" ? "active" : "suspended");
      setTenants((prev) =>
        prev.map((row) => (row.id === tenant.id ? { ...row, status: nextStatus } : row))
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `Failed to ${action} tenant`);
    } finally {
      setBusyByTenant((prev) => ({ ...prev, [tenant.id]: false }));
    }
  }

  async function addCredits(tenant: TenantRow) {
    const amountInput = window.prompt("Amount in USD (negative to deduct)", "10");
    if (!amountInput) {
      return;
    }

    const amountUsd = Number(amountInput);
    if (!Number.isFinite(amountUsd) || amountUsd === 0) {
      setError("Amount must be a non-zero number");
      return;
    }

    const amountCents = Math.round(amountUsd * 100);
    if (amountCents === 0) {
      setError("Amount is too small after cents conversion");
      return;
    }

    const reason = window.prompt("Reason for adjustment", "Manual admin adjustment")?.trim();
    if (!reason) {
      return;
    }

    setBusyByTenant((prev) => ({ ...prev, [tenant.id]: true }));
    setError(null);

    try {
      const response = await fetch(`/api/admin/tenants/${tenant.id}/credits`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amountCents, reason }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { balance_cents?: number; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to adjust credits");
      }

      if (typeof payload?.balance_cents === "number") {
        setTenants((prev) =>
          prev.map((row) =>
            row.id === tenant.id
              ? { ...row, credits_balance_cents: payload.balance_cents }
              : row
          )
        );
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to adjust credits");
    } finally {
      setBusyByTenant((prev) => ({ ...prev, [tenant.id]: false }));
    }
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadTenants(query);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-white">Tenants</h1>
        <p className="mt-1 text-sm text-gray-400">Manage tenant status, credits, and container state.</p>
      </header>

      <form onSubmit={handleSearch} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by email, status, or container"
          className="min-w-[260px] flex-1 rounded-md border border-[#27273a] bg-[#0d0d14] px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500"
        />
        <button
          type="submit"
          className="rounded-md bg-[#2d6cdf] px-4 py-2 text-sm font-medium text-white hover:bg-[#2258b7]"
        >
          Search
        </button>
        <button
          type="button"
          onClick={() => {
            setQuery("");
            void loadTenants("");
          }}
          className="rounded-md border border-[#3f3f62] px-4 py-2 text-sm text-gray-200 hover:bg-[#1a1a2b]"
        >
          Reset
        </button>
      </form>

      {error && (
        <p className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading tenants...</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#1d1d2c] bg-[#11111a]">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[#1d1d2c] bg-[#131320] text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Credits</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Container State</th>
                <th className="px-4 py-3 font-medium">Last Active</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orderedTenants.map((tenant) => {
                const busy = Boolean(busyByTenant[tenant.id]);
                const isSuspended = tenant.status === "suspended";
                const creditsCents = tenant.credits_balance_cents ?? 0;
                const state = containerState(tenant);

                return (
                  <tr key={tenant.id} className="border-t border-[#1d1d2c] text-gray-200">
                    <td className="px-4 py-3 font-medium text-white">{displayName(tenant)}</td>
                    <td className="px-4 py-3 text-gray-300">{tenant.email || "-"}</td>
                    <td className="px-4 py-3 text-emerald-300">{formatDollarsFromCents(creditsCents)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                          isSuspended
                            ? "bg-red-500/20 text-red-200"
                            : "bg-emerald-500/20 text-emerald-200"
                        }`}
                      >
                        {tenant.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-[#1a1a2b] px-2 py-1 text-xs text-gray-300">{state}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{lastActiveLabel(tenant)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            void toggleTenantStatus(tenant);
                          }}
                          disabled={busy}
                          className="rounded-md border border-[#3f3f62] px-2 py-1 text-xs text-gray-200 hover:bg-[#1a1a2b] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isSuspended ? "Resume" : "Suspend"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void addCredits(tenant);
                          }}
                          disabled={busy}
                          className="rounded-md border border-emerald-700/70 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-950/30 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Add Credits
                        </button>
                        <Link
                          href={`/admin/tenants/${tenant.id}`}
                          className="rounded-md border border-[#2d6cdf]/70 px-2 py-1 text-xs text-[#8db3ff] hover:bg-[#2d6cdf]/10"
                        >
                          View Details
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {orderedTenants.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No tenants found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
