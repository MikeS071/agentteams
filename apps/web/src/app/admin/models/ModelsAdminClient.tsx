"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type AdminModel = {
  id: string;
  name: string;
  provider: string;
  costPer1kInput: number;
  costPer1kOutput: number;
  markupPct: number;
  enabled: boolean;
};

type AddModelForm = {
  id: string;
  name: string;
  provider: string;
  costPer1kInput: string;
  costPer1kOutput: string;
  markupPct: string;
  enabled: boolean;
};

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(value);
}

function asInputValue(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return String(value);
}

function userPrice(value: number, markupPct: number): number {
  return value * (1 + markupPct / 100);
}

function createModelId(name: string, provider: string): string {
  const safe = `${provider}-${name}`
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `${safe || "model"}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function ModelsAdminClient() {
  const [models, setModels] = useState<AdminModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingById, setPendingById] = useState<Record<string, boolean>>({});
  const [addPending, setAddPending] = useState(false);
  const [form, setForm] = useState<AddModelForm>({
    id: "",
    name: "",
    provider: "",
    costPer1kInput: "",
    costPer1kOutput: "",
    markupPct: "30",
    enabled: true,
  });

  useEffect(() => {
    let mounted = true;

    async function loadModels() {
      try {
        const response = await fetch("/api/admin/models", { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as
          | { models?: AdminModel[]; error?: string }
          | null;

        if (!response.ok) {
          throw new Error(payload?.error ?? "Failed to load models");
        }

        if (mounted) {
          setModels(Array.isArray(payload?.models) ? payload.models : []);
          setError(null);
        }
      } catch (requestError) {
        if (mounted) {
          setError(requestError instanceof Error ? requestError.message : "Failed to load models");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadModels();
    return () => {
      mounted = false;
    };
  }, []);

  const sortedModels = useMemo(
    () => [...models].sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name)),
    [models]
  );

  function patchLocalModel(id: string, patch: Partial<AdminModel>) {
    setModels((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  async function saveRow(model: AdminModel) {
    if (model.costPer1kInput < 0 || model.costPer1kOutput < 0) {
      setError("Costs must be zero or greater");
      return;
    }
    if (!Number.isFinite(model.markupPct) || model.markupPct < 0 || model.markupPct > 1000) {
      setError("Markup must be between 0 and 1000");
      return;
    }

    setPendingById((prev) => ({ ...prev, [model.id]: true }));
    setError(null);

    try {
      const response = await fetch(`/api/admin/models/${model.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          costPer1kInput: model.costPer1kInput,
          costPer1kOutput: model.costPer1kOutput,
          markupPct: model.markupPct,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { model?: AdminModel; error?: string }
        | null;

      if (!response.ok || !payload?.model) {
        throw new Error(payload?.error ?? "Failed to update model");
      }

      patchLocalModel(model.id, payload.model);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to update model");
    } finally {
      setPendingById((prev) => ({ ...prev, [model.id]: false }));
    }
  }

  async function handleAddModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const inputCost = Number(form.costPer1kInput);
    const outputCost = Number(form.costPer1kOutput);
    const markup = Number(form.markupPct);

    if (!form.name.trim() || !form.provider.trim()) {
      setError("Name and provider are required");
      return;
    }
    if (!Number.isFinite(inputCost) || inputCost < 0 || !Number.isFinite(outputCost) || outputCost < 0) {
      setError("Cost values must be zero or greater");
      return;
    }
    if (!Number.isFinite(markup) || markup < 0 || markup > 1000) {
      setError("Markup must be between 0 and 1000");
      return;
    }

    setAddPending(true);

    try {
      const id = form.id.trim() || createModelId(form.name, form.provider);
      const response = await fetch("/api/admin/models", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id,
          name: form.name,
          provider: form.provider,
          costPer1kInput: inputCost,
          costPer1kOutput: outputCost,
          markupPct: markup,
          enabled: form.enabled,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { model?: AdminModel; error?: string }
        | null;

      if (!response.ok || !payload?.model) {
        throw new Error(payload?.error ?? "Failed to add model");
      }

      setModels((prev) => [payload.model!, ...prev]);
      setForm({
        id: "",
        name: "",
        provider: "",
        costPer1kInput: "",
        costPer1kOutput: "",
        markupPct: "30",
        enabled: true,
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to add model");
    } finally {
      setAddPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-white">Model Management</h1>
        <p className="mt-1 text-sm text-gray-400">Edit input/output pricing and markup inline.</p>
      </header>

      <form
        onSubmit={handleAddModel}
        className="grid gap-3 rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4 md:grid-cols-[1.3fr_1.3fr_1fr_1fr_1fr_auto_auto]"
      >
        <input
          type="text"
          value={form.id}
          onChange={(event) => setForm((prev) => ({ ...prev, id: event.target.value }))}
          placeholder="Model ID (optional)"
          className="rounded-md border border-[#27273a] bg-[#0d0d14] px-3 py-2 text-sm text-gray-100"
        />
        <input
          type="text"
          value={form.name}
          onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          placeholder="Model name"
          className="rounded-md border border-[#27273a] bg-[#0d0d14] px-3 py-2 text-sm text-gray-100"
        />
        <input
          type="text"
          value={form.provider}
          onChange={(event) => setForm((prev) => ({ ...prev, provider: event.target.value }))}
          placeholder="Provider"
          className="rounded-md border border-[#27273a] bg-[#0d0d14] px-3 py-2 text-sm text-gray-100"
        />
        <input
          type="number"
          min="0"
          step="0.000001"
          value={form.costPer1kInput}
          onChange={(event) => setForm((prev) => ({ ...prev, costPer1kInput: event.target.value }))}
          placeholder="Cost /1K Input"
          className="rounded-md border border-[#27273a] bg-[#0d0d14] px-3 py-2 text-sm text-gray-100"
        />
        <input
          type="number"
          min="0"
          step="0.000001"
          value={form.costPer1kOutput}
          onChange={(event) => setForm((prev) => ({ ...prev, costPer1kOutput: event.target.value }))}
          placeholder="Cost /1K Output"
          className="rounded-md border border-[#27273a] bg-[#0d0d14] px-3 py-2 text-sm text-gray-100"
        />
        <input
          type="number"
          min="0"
          max="1000"
          value={form.markupPct}
          onChange={(event) => setForm((prev) => ({ ...prev, markupPct: event.target.value }))}
          placeholder="Markup %"
          className="rounded-md border border-[#27273a] bg-[#0d0d14] px-3 py-2 text-sm text-gray-100"
        />
        <button
          type="submit"
          disabled={addPending}
          className="rounded-md bg-[#2d6cdf] px-4 py-2 text-sm font-medium text-white hover:bg-[#2258b7] disabled:opacity-60"
        >
          {addPending ? "Adding..." : "Add"}
        </button>
      </form>

      {error && (
        <p className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading models...</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#1d1d2c] bg-[#11111a]">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[#1d1d2c] bg-[#131320] text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Cost / 1K Input</th>
                <th className="px-4 py-3 font-medium">Cost / 1K Output</th>
                <th className="px-4 py-3 font-medium">Markup %</th>
                <th className="px-4 py-3 font-medium">Enabled</th>
                <th className="px-4 py-3 font-medium">User Price / 1K In</th>
                <th className="px-4 py-3 font-medium">User Price / 1K Out</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {sortedModels.map((model) => {
                const busy = Boolean(pendingById[model.id]);

                return (
                  <tr key={model.id} className="border-t border-[#1d1d2c] text-gray-200">
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{model.name}</p>
                      <p className="text-xs text-gray-500">{model.id}</p>
                    </td>
                    <td className="px-4 py-3">{model.provider}</td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        value={asInputValue(model.costPer1kInput)}
                        onChange={(event) =>
                          patchLocalModel(model.id, {
                            costPer1kInput: Number(event.target.value),
                          })
                        }
                        className="w-28 rounded-md border border-[#27273a] bg-[#0d0d14] px-2 py-1 text-gray-100"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        value={asInputValue(model.costPer1kOutput)}
                        onChange={(event) =>
                          patchLocalModel(model.id, {
                            costPer1kOutput: Number(event.target.value),
                          })
                        }
                        className="w-28 rounded-md border border-[#27273a] bg-[#0d0d14] px-2 py-1 text-gray-100"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min="0"
                        max="1000"
                        value={asInputValue(model.markupPct)}
                        onChange={(event) =>
                          patchLocalModel(model.id, {
                            markupPct: Number(event.target.value),
                          })
                        }
                        className="w-24 rounded-md border border-[#27273a] bg-[#0d0d14] px-2 py-1 text-gray-100"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                          model.enabled
                            ? "bg-emerald-500/20 text-emerald-200"
                            : "bg-gray-500/20 text-gray-200"
                        }`}
                      >
                        {model.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-emerald-300">
                      {formatUsd(userPrice(model.costPer1kInput, model.markupPct))}
                    </td>
                    <td className="px-4 py-3 text-emerald-300">
                      {formatUsd(userPrice(model.costPer1kOutput, model.markupPct))}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          void saveRow(model);
                        }}
                        disabled={busy}
                        className="rounded-md border border-[#3f3f62] px-3 py-1 text-xs text-gray-200 hover:bg-[#1a1a2b] disabled:opacity-60"
                      >
                        {busy ? "Saving..." : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })}
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
      )}
    </div>
  );
}
