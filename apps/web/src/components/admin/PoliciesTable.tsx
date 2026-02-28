"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FEATURES, type Feature } from "@/lib/features";

type TenantPolicySummary = {
  tenantId: string;
  tenantName: string;
  email: string | null;
  features: Record<Feature, boolean>;
};

type ApiPayload = {
  features: Feature[];
  tenants: TenantPolicySummary[];
};

function featureLabel(feature: Feature): string {
  return feature.charAt(0).toUpperCase() + feature.slice(1);
}

export default function PoliciesTable() {
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tenants, setTenants] = useState<TenantPolicySummary[]>([]);
  const [availableFeatures, setAvailableFeatures] = useState<Feature[]>([
    ...FEATURES,
  ]);

  const loadPolicies = useCallback(async (searchTerm: string) => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (searchTerm.trim()) {
      params.set("search", searchTerm.trim());
    }

    try {
      const url = params.toString()
        ? `/api/admin/policies?${params.toString()}`
        : "/api/admin/policies";
      const response = await fetch(url, { cache: "no-store" });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? "Failed to load policies");
      }

      const payload = (await response.json()) as ApiPayload;
      setAvailableFeatures(payload.features ?? [...FEATURES]);
      setTenants(payload.tenants ?? []);
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Failed to load policies";
      setError(message);
      setTenants([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPolicies(activeSearch);
  }, [activeSearch, loadPolicies]);

  const tenantCountLabel = useMemo(() => {
    if (loading) return "Loading tenants...";
    if (tenants.length === 1) return "1 tenant";
    return `${tenants.length} tenants`;
  }, [loading, tenants.length]);

  async function updatePolicy(payload: {
    tenantId?: string;
    feature: Feature;
    enabled: boolean;
    allTenants?: boolean;
  }) {
    const actionKey = payload.allTenants
      ? `bulk:${payload.feature}:${payload.enabled}`
      : `${payload.tenantId}:${payload.feature}`;

    setSaving(actionKey);
    setError(null);

    try {
      const response = await fetch("/api/admin/policies", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? "Failed to update policy");
      }

      await loadPolicies(activeSearch);
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Failed to update policy";
      setError(message);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-[#202034] bg-[#10101a] p-4 sm:flex-row sm:items-center sm:justify-between">
        <form
          className="flex w-full max-w-md items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setActiveSearch(search);
          }}
        >
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tenant by name or email"
            className="w-full rounded-md border border-[#2d2d44] bg-[#0d0d15] px-3 py-2 text-sm text-gray-100 outline-none ring-[#6c5ce7] placeholder:text-gray-500 focus:ring-2"
          />
          <button
            type="submit"
            className="rounded-md border border-[#383853] px-3 py-2 text-sm text-gray-200 hover:bg-[#171729]"
          >
            Search
          </button>
        </form>
        <p className="text-sm text-gray-400">{tenantCountLabel}</p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-[#202034] bg-[#10101a]">
        <table className="min-w-full divide-y divide-[#23233a]">
          <thead className="bg-[#141424]">
            <tr>
              <th className="sticky left-0 z-10 min-w-[220px] bg-[#141424] px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
                Tenant
              </th>
              {availableFeatures.map((feature) => {
                const bulkEnableKey = `bulk:${feature}:true`;
                const bulkDisableKey = `bulk:${feature}:false`;

                return (
                  <th
                    key={feature}
                    className="min-w-[180px] px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400"
                  >
                    <div className="space-y-2">
                      <div>{featureLabel(feature)}</div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          disabled={!!saving}
                          onClick={() =>
                            void updatePolicy({
                              feature,
                              enabled: true,
                              allTenants: true,
                            })
                          }
                          className="rounded border border-emerald-700/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
                        >
                          {saving === bulkEnableKey ? "..." : "Enable all"}
                        </button>
                        <button
                          type="button"
                          disabled={!!saving}
                          onClick={() =>
                            void updatePolicy({
                              feature,
                              enabled: false,
                              allTenants: true,
                            })
                          }
                          className="rounded border border-red-700/40 bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                        >
                          {saving === bulkDisableKey ? "..." : "Disable all"}
                        </button>
                      </div>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1d1d31]">
            {loading ? (
              <tr>
                <td
                  colSpan={1 + availableFeatures.length}
                  className="px-4 py-8 text-center text-sm text-gray-400"
                >
                  Loading policies...
                </td>
              </tr>
            ) : tenants.length === 0 ? (
              <tr>
                <td
                  colSpan={1 + availableFeatures.length}
                  className="px-4 py-8 text-center text-sm text-gray-500"
                >
                  No tenants match your filter.
                </td>
              </tr>
            ) : (
              tenants.map((tenant) => (
                <tr key={tenant.tenantId} className="hover:bg-[#131322]">
                  <td className="sticky left-0 z-10 bg-[#10101a] px-4 py-3">
                    <p className="text-sm font-medium text-gray-100">{tenant.tenantName}</p>
                    {tenant.email ? <p className="text-xs text-gray-500">{tenant.email}</p> : null}
                  </td>
                  {availableFeatures.map((feature) => {
                    const enabled = tenant.features[feature];
                    const rowActionKey = `${tenant.tenantId}:${feature}`;
                    const isSaving = saving === rowActionKey;

                    return (
                      <td key={feature} className="px-4 py-3">
                        <button
                          type="button"
                          disabled={!!saving}
                          onClick={() =>
                            void updatePolicy({
                              tenantId: tenant.tenantId,
                              feature,
                              enabled: !enabled,
                            })
                          }
                          className={`inline-flex h-7 w-14 items-center rounded-full border px-1 transition ${
                            enabled
                              ? "border-emerald-600/50 bg-emerald-500/20"
                              : "border-gray-600/50 bg-gray-700/30"
                          } disabled:opacity-50`}
                          aria-label={`Toggle ${feature} for ${tenant.tenantName}`}
                        >
                          <span
                            className={`h-5 w-5 rounded-full transition ${
                              enabled ? "translate-x-7 bg-emerald-300" : "translate-x-0 bg-gray-300"
                            } ${isSaving ? "animate-pulse" : ""}`}
                          />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
