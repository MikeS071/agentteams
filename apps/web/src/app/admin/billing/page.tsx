"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  BarChart,
  Bar,
} from "recharts";
import type { BillingPayload } from "@/lib/admin-mock";

type RevenuePeriod = "daily" | "weekly" | "monthly";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatCurrencyTooltip(value: number | string | undefined): string {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return currencyFormatter.format(Number.isFinite(numeric) ? numeric : 0);
}

function csvEscape(value: string | number): string {
  const text = String(value);
  if (/[,"\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadCsv(data: BillingPayload): void {
  const lines: string[] = [];

  lines.push("section,tenant_id,tenant_name,spending,credits_granted,refunds,current_balance");
  for (const tenant of data.tenantBreakdown) {
    lines.push(
      [
        "tenant_breakdown",
        tenant.tenantId,
        tenant.tenantName,
        tenant.spending,
        tenant.creditsGranted,
        tenant.refunds,
        tenant.currentBalance,
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  lines.push("");
  lines.push("section,period_start,label,revenue,cost");
  for (const point of data.revenue.daily) {
    lines.push(["daily_revenue", point.periodStart, point.label, point.revenue, point.cost].map(csvEscape).join(","));
  }
  for (const point of data.revenue.weekly) {
    lines.push(["weekly_revenue", point.periodStart, point.label, point.revenue, point.cost].map(csvEscape).join(","));
  }
  for (const point of data.revenue.monthly) {
    lines.push(["monthly_revenue", point.periodStart, point.label, point.revenue, point.cost].map(csvEscape).join(","));
  }

  lines.push("");
  lines.push("section,model,revenue,cost");
  for (const model of data.marginByModel) {
    lines.push(["model_margin", model.model, model.revenue, model.cost].map(csvEscape).join(","));
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `admin-billing-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

export default function AdminBillingPage() {
  const [data, setData] = useState<BillingPayload | null>(null);
  const [period, setPeriod] = useState<RevenuePeriod>("daily");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const response = await fetch("/api/admin/billing", { cache: "no-store" });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? "Failed to load billing data");
        }

        const payload = (await response.json()) as BillingPayload;
        if (!mounted) return;
        setData(payload);
      } catch (requestError) {
        if (!mounted) return;
        const message = requestError instanceof Error ? requestError.message : "Unknown error";
        setError(message);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const activeSeries = useMemo(() => {
    if (!data) return [];
    return data.revenue[period];
  }, [data, period]);

  if (loading) {
    return <div className="p-6 text-sm text-gray-400">Loading billing dashboard...</div>;
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {error ?? "No billing data available."}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-4 text-gray-100 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-xl border border-[#2a2a38] bg-[#11111a] p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">Billing Admin</h1>
              <p className="mt-1 text-sm text-gray-400">
                Generated {dateTimeFormatter.format(new Date(data.generatedAt))}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-[#343448] bg-[#181826] px-3 py-1 text-xs uppercase tracking-wide text-gray-300">
                {data.source === "database" ? "Database" : "Mock"}
              </span>
              <button
                type="button"
                onClick={() => downloadCsv(data)}
                className="rounded-lg bg-[#00b894] px-3 py-2 text-sm font-medium text-black transition hover:bg-[#26d6af]"
              >
                Export CSV
              </button>
            </div>
          </div>
        </header>

        <section className="rounded-xl border border-[#2a2a38] bg-[#11111a] p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Revenue Trends</h2>
            <div className="inline-flex rounded-lg border border-[#2f2f43] bg-[#171724] p-1">
              {(["daily", "weekly", "monthly"] as RevenuePeriod[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setPeriod(option)}
                  className={`rounded-md px-3 py-1 text-sm capitalize ${
                    period === option ? "bg-[#6c5ce7] text-white" : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={activeSeries}>
                <CartesianGrid stroke="#2c2c42" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#a0a0b8" tickLine={false} axisLine={false} />
                <YAxis stroke="#a0a0b8" tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={formatCurrencyTooltip}
                  contentStyle={{
                    backgroundColor: "#12121a",
                    border: "1px solid #2c2c42",
                    borderRadius: "8px",
                    color: "#e8e8f0",
                  }}
                />
                <Legend />
                <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#00d2d3" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="cost" name="Cost" stroke="#ff7675" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-xl border border-[#2a2a38] bg-[#11111a] p-4 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold">Margin Analysis by Model</h2>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.marginByModel}>
                <CartesianGrid stroke="#2c2c42" strokeDasharray="3 3" />
                <XAxis dataKey="model" stroke="#a0a0b8" tickLine={false} axisLine={false} />
                <YAxis stroke="#a0a0b8" tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={formatCurrencyTooltip}
                  contentStyle={{
                    backgroundColor: "#12121a",
                    border: "1px solid #2c2c42",
                    borderRadius: "8px",
                    color: "#e8e8f0",
                  }}
                />
                <Legend />
                <Bar dataKey="revenue" name="Revenue" fill="#00cec9" radius={[4, 4, 0, 0]} />
                <Bar dataKey="cost" name="Cost" fill="#6c5ce7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-[#2a2a38] bg-[#11111a] p-4 sm:p-6">
            <h2 className="mb-4 text-lg font-semibold">Usage Spike Alerts</h2>
            {data.alerts.length === 0 ? (
              <p className="text-sm text-gray-400">No spikes over 3x daily average in the current window.</p>
            ) : (
              <div className="space-y-3">
                {data.alerts.slice(0, 8).map((alert) => (
                  <div key={alert.id} className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                    <p className="font-medium text-amber-200">{alert.tenantName}</p>
                    <p className="text-amber-100/90">
                      {alert.date}: {currencyFormatter.format(alert.amount)} ({alert.ratio.toFixed(2)}x avg {currencyFormatter.format(alert.average)})
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[#2a2a38] bg-[#11111a] p-4 sm:p-6">
            <h2 className="mb-4 text-lg font-semibold">Per-Tenant Breakdown</h2>
            <div className="max-h-96 overflow-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 bg-[#11111a] text-xs uppercase tracking-wide text-gray-400">
                  <tr>
                    <th className="px-2 py-2 font-medium">Tenant</th>
                    <th className="px-2 py-2 font-medium">Spending</th>
                    <th className="px-2 py-2 font-medium">Credits</th>
                    <th className="px-2 py-2 font-medium">Refunds</th>
                    <th className="px-2 py-2 font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tenantBreakdown.map((tenant) => (
                    <tr key={tenant.tenantId} className="border-t border-[#2a2a38]">
                      <td className="px-2 py-2">{tenant.tenantName}</td>
                      <td className="px-2 py-2">{currencyFormatter.format(tenant.spending)}</td>
                      <td className="px-2 py-2">{currencyFormatter.format(tenant.creditsGranted)}</td>
                      <td className="px-2 py-2">{currencyFormatter.format(tenant.refunds)}</td>
                      <td className="px-2 py-2">{currencyFormatter.format(tenant.currentBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
