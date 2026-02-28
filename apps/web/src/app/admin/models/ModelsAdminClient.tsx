"use client";

import { FormEvent, useMemo, useState } from "react";
import type { AdminModel } from "@/lib/adminModels";

type AddFormState = {
  name: string;
  provider: string;
  providerCostPer1k: string;
  markupPct: string;
};

type Props = {
  initialModels: AdminModel[];
};

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(value);
}

function formatUsdFromCents(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

export default function ModelsAdminClient({ initialModels }: Props) {
  const [models, setModels] = useState<AdminModel[]>(initialModels);
  const [pendingById, setPendingById] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [addPending, setAddPending] = useState(false);
  const [form, setForm] = useState<AddFormState>({
    name: "",
    provider: "",
    providerCostPer1k: "",
    markupPct: "30",
  });

  const sortedModels = useMemo(
    () => [...models].sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name)),
    [models]
  );

  async function patchModel(
    id: string,
    patch: { markupPct?: number; enabled?: boolean },
    rollback: AdminModel
  ) {
    setPendingById((prev) => ({ ...prev, [id]: true }));
    setError(null);

    try {
      const response = await fetch(`/api/admin/models/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await response.json()) as { model?: AdminModel; error?: string };
      if (!response.ok || !data.model) {
        throw new Error(data.error ?? "Failed to update model");
      }

      setModels((prev) => prev.map((model) => (model.id === id ? data.model! : model)));
    } catch (err) {
      setModels((prev) => prev.map((model) => (model.id === id ? rollback : model)));
      setError(err instanceof Error ? err.message : "Failed to update model");
    } finally {
      setPendingById((prev) => ({ ...prev, [id]: false }));
    }
  }

  async function handleMarkupBlur(model: AdminModel, nextMarkupRaw: string) {
    const nextMarkup = Number(nextMarkupRaw);
    if (!Number.isFinite(nextMarkup) || nextMarkup < 0 || nextMarkup > 500) {
      setError("Markup must be between 0 and 500");
      setModels((prev) => prev.map((item) => (item.id === model.id ? model : item)));
      return;
    }

    if (nextMarkup === model.markupPct) {
      return;
    }

    const optimisticModel: AdminModel = {
      ...model,
      markupPct: nextMarkup,
      userPricePer1k: model.providerCostPer1k * (1 + nextMarkup / 100),
    };

    setModels((prev) => prev.map((item) => (item.id === model.id ? optimisticModel : item)));
    await patchModel(model.id, { markupPct: nextMarkup }, model);
  }

  async function handleToggle(model: AdminModel, enabled: boolean) {
    const optimisticModel: AdminModel = { ...model, enabled };
    setModels((prev) => prev.map((item) => (item.id === model.id ? optimisticModel : item)));
    await patchModel(model.id, { enabled }, model);
  }

  async function handleDelete(model: AdminModel) {
    if (!window.confirm(`Delete model "${model.name}"? This is a soft delete.`)) {
      return;
    }

    setError(null);
    setPendingById((prev) => ({ ...prev, [model.id]: true }));
    const previousModels = models;
    setModels((prev) => prev.filter((item) => item.id !== model.id));

    try {
      const response = await fetch(`/api/admin/models/${model.id}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Failed to delete model");
      }
    } catch (err) {
      setModels(previousModels);
      setError(err instanceof Error ? err.message : "Failed to delete model");
    } finally {
      setPendingById((prev) => ({ ...prev, [model.id]: false }));
    }
  }

  async function handleAddModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const providerCostPer1k = Number(form.providerCostPer1k);
    const markupPct = Number(form.markupPct);

    if (!form.name.trim() || !form.provider.trim()) {
      setError("Name and provider are required");
      return;
    }
    if (!Number.isFinite(providerCostPer1k) || providerCostPer1k <= 0) {
      setError("Provider cost must be positive");
      return;
    }
    if (!Number.isFinite(markupPct) || markupPct < 0 || markupPct > 500) {
      setError("Markup must be between 0 and 500");
      return;
    }

    setAddPending(true);
    try {
      const response = await fetch("/api/admin/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          provider: form.provider,
          providerCostPer1k,
          markupPct,
        }),
      });
      const data = (await response.json()) as { model?: AdminModel; error?: string };
      if (!response.ok || !data.model) {
        throw new Error(data.error ?? "Failed to create model");
      }

      setModels((prev) => [data.model!, ...prev]);
      setForm({
        name: "",
        provider: "",
        providerCostPer1k: "",
        markupPct: "30",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create model");
    } finally {
      setAddPending(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] px-4 py-8 text-gray-100 sm:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">Model Config + Margin</h1>
          <p className="mt-2 text-sm text-gray-400">
            Manage provider cost, markup, and model availability. User price is calculated automatically.
          </p>
        </div>

        <form
          onSubmit={handleAddModel}
          className="grid gap-3 rounded-xl border border-[#1d1d2c] bg-[#10101a] p-4 md:grid-cols-[2fr_1fr_1fr_1fr_auto]"
        >
          <input
            className="rounded-md border border-[#27273a] bg-[#0d0d14] px-3 py-2 text-sm text-white outline-none ring-[#46466a] placeholder:text-gray-500 focus:ring-2"
            placeholder="Model name"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          />
          <input
            className="rounded-md border border-[#27273a] bg-[#0d0d14] px-3 py-2 text-sm text-white outline-none ring-[#46466a] placeholder:text-gray-500 focus:ring-2"
            placeholder="Provider"
            value={form.provider}
            onChange={(event) => setForm((prev) => ({ ...prev, provider: event.target.value }))}
          />
          <input
            type="number"
            min="0"
            step="0.000001"
            className="rounded-md border border-[#27273a] bg-[#0d0d14] px-3 py-2 text-sm text-white outline-none ring-[#46466a] placeholder:text-gray-500 focus:ring-2"
            placeholder="Cost / 1K (USD)"
            value={form.providerCostPer1k}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, providerCostPer1k: event.target.value }))
            }
          />
          <input
            type="number"
            min="0"
            max="500"
            step="1"
            className="rounded-md border border-[#27273a] bg-[#0d0d14] px-3 py-2 text-sm text-white outline-none ring-[#46466a] placeholder:text-gray-500 focus:ring-2"
            placeholder="Markup %"
            value={form.markupPct}
            onChange={(event) => setForm((prev) => ({ ...prev, markupPct: event.target.value }))}
          />
          <button
            type="submit"
            disabled={addPending}
            className="rounded-md bg-[#2d6cdf] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#2258b7] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {addPending ? "Adding..." : "Add model"}
          </button>
        </form>

        {error && (
          <p className="rounded-md border border-red-800/70 bg-red-950/30 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}

        <div className="overflow-x-auto rounded-xl border border-[#1d1d2c] bg-[#10101a]">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[#1d1d2c] bg-[#131320] text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Provider Cost / 1K</th>
                <th className="px-4 py-3 font-medium">Markup %</th>
                <th className="px-4 py-3 font-medium">User Price / 1K</th>
                <th className="px-4 py-3 font-medium">Revenue (24h)</th>
                <th className="px-4 py-3 font-medium">Revenue (7d)</th>
                <th className="px-4 py-3 font-medium">Enabled</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedModels.map((model) => (
                <tr key={model.id} className="border-b border-[#1d1d2c] last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{model.name}</div>
                    <div className="text-xs text-gray-500">{model.id}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{model.provider}</td>
                  <td className="px-4 py-3 text-gray-300">{formatUsd(model.providerCostPer1k)}</td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min="0"
                      max="500"
                      step="1"
                      defaultValue={model.markupPct}
                      onBlur={(event) => {
                        void handleMarkupBlur(model, event.currentTarget.value);
                      }}
                      disabled={Boolean(pendingById[model.id])}
                      className="w-24 rounded-md border border-[#27273a] bg-[#0d0d14] px-2 py-1 text-gray-100 outline-none ring-[#46466a] focus:ring-2 disabled:opacity-50"
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-300">{formatUsd(model.userPricePer1k)}</td>
                  <td className="px-4 py-3 text-gray-300">{formatUsdFromCents(model.dailyRevenueCents)}</td>
                  <td className="px-4 py-3 text-gray-300">{formatUsdFromCents(model.weeklyRevenueCents)}</td>
                  <td className="px-4 py-3">
                    <label className="inline-flex items-center gap-2 text-gray-300">
                      <input
                        type="checkbox"
                        checked={model.enabled}
                        onChange={(event) => {
                          void handleToggle(model, event.currentTarget.checked);
                        }}
                        disabled={Boolean(pendingById[model.id])}
                        className="h-4 w-4 accent-[#2d6cdf] disabled:opacity-50"
                      />
                      {model.enabled ? "On" : "Off"}
                    </label>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => {
                        void handleDelete(model);
                      }}
                      disabled={Boolean(pendingById[model.id])}
                      className="rounded-md border border-red-900/70 bg-red-950/30 px-3 py-1 text-xs font-medium text-red-200 transition hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {sortedModels.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                    No models found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
