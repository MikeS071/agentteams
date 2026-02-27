"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";

type DailyUsagePointApi = {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
};

type DailyUsagePoint = DailyUsagePointApi & {
  label: string;
};

type ModelUsagePoint = {
  model: string;
  totalCost: number;
  totalTokens: number;
};

type RecentUsagePoint = {
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
};

type BalanceResponse = {
  balanceCents: number;
  initialCreditCents: number;
  remainingPct: number;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const numberFormatter = new Intl.NumberFormat("en-US");
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const pieColors = ["#6c5ce7", "#00cec9", "#a29bfe", "#55efc4", "#fdcb6e", "#e17055"];

function buildLast30Days(data: DailyUsagePointApi[]): DailyUsagePoint[] {
  const byDate = new Map<string, DailyUsagePointApi>();

  for (const item of data) {
    byDate.set(item.date.slice(0, 10), item);
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const points: DailyUsagePoint[] = [];
  for (let offset = 29; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() - offset);

    const key = day.toISOString().slice(0, 10);
    const value = byDate.get(key);
    const month = String(day.getUTCMonth() + 1).padStart(2, "0");
    const date = String(day.getUTCDate()).padStart(2, "0");

    points.push({
      date: key,
      label: `${month}/${date}`,
      inputTokens: value?.inputTokens ?? 0,
      outputTokens: value?.outputTokens ?? 0,
      cost: value?.cost ?? 0,
    });
  }

  return points;
}

function getBalanceClass(remainingPct: number): string {
  if (remainingPct > 50) return "text-emerald-400";
  if (remainingPct >= 10) return "text-amber-400";
  return "text-red-400";
}

function getWarning(remainingPct: number): { className: string; message: string } | null {
  if (remainingPct <= 5) {
    return {
      className: "border-red-500/40 bg-red-500/10 text-red-200",
      message: "Critical: 5% or less credit remaining. Top up credits to avoid service interruption.",
    };
  }

  if (remainingPct <= 10) {
    return {
      className: "border-orange-500/40 bg-orange-500/10 text-orange-200",
      message: "Warning: 10% or less credit remaining. Plan a top-up soon.",
    };
  }

  if (remainingPct <= 20) {
    return {
      className: "border-amber-500/40 bg-amber-500/10 text-amber-200",
      message: "Notice: 20% or less credit remaining.",
    };
  }

  return null;
}

export default function UsageDashboard() {
  const [dailyUsage, setDailyUsage] = useState<DailyUsagePointApi[]>([]);
  const [modelUsage, setModelUsage] = useState<ModelUsagePoint[]>([]);
  const [recentUsage, setRecentUsage] = useState<RecentUsagePoint[]>([]);
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      try {
        const [dailyResponse, byModelResponse, recentResponse, balanceResponse] =
          await Promise.all([
            fetch("/api/usage/daily", { cache: "no-store" }),
            fetch("/api/usage/by-model", { cache: "no-store" }),
            fetch("/api/usage/recent", { cache: "no-store" }),
            fetch("/api/billing/balance", { cache: "no-store" }),
          ]);

        if (!dailyResponse.ok || !byModelResponse.ok || !recentResponse.ok || !balanceResponse.ok) {
          throw new Error("Failed to load usage data.");
        }

        const [dailyData, byModelData, recentData, balanceData] = await Promise.all([
          dailyResponse.json() as Promise<DailyUsagePointApi[]>,
          byModelResponse.json() as Promise<ModelUsagePoint[]>,
          recentResponse.json() as Promise<RecentUsagePoint[]>,
          balanceResponse.json() as Promise<BalanceResponse>,
        ]);

        if (!isMounted) return;

        setDailyUsage(dailyData);
        setModelUsage(byModelData);
        setRecentUsage(recentData);
        setBalance(balanceData);
      } catch (loadError) {
        console.error(loadError);
        if (isMounted) {
          setError("Unable to load usage dashboard data.");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  const dailySeries = useMemo(() => buildLast30Days(dailyUsage), [dailyUsage]);
  const warning = useMemo(() => (balance ? getWarning(balance.remainingPct) : null), [balance]);

  if (loading) {
    return <div className="text-text2">Loading usage dashboard...</div>;
  }

  if (error) {
    return <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-bg3 bg-bg2 p-6">
        <p className="text-sm uppercase tracking-wide text-text2">Current Credit Balance</p>
        <p className={`mt-3 text-4xl font-semibold sm:text-5xl ${getBalanceClass(balance?.remainingPct ?? 100)}`}>
          {currencyFormatter.format((balance?.balanceCents ?? 0) / 100)}
        </p>
        <p className="mt-2 text-sm text-text2">
          {(balance?.remainingPct ?? 0).toFixed(1)}% of initial credit remaining
        </p>
      </section>

      {warning && (
        <section className={`rounded-xl border px-4 py-3 text-sm ${warning.className}`}>{warning.message}</section>
      )}

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-bg3 bg-bg2 p-4">
          <h2 className="mb-4 text-lg font-semibold text-text">Daily Token Usage (30 Days)</h2>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailySeries}>
                <CartesianGrid stroke="#2c2c42" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#a0a0b8" tickLine={false} axisLine={false} />
                <YAxis stroke="#a0a0b8" tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#12121a",
                    border: "1px solid #2c2c42",
                    borderRadius: "8px",
                    color: "#e8e8f0",
                  }}
                />
                <Legend />
                <Bar dataKey="inputTokens" stackId="tokens" name="Input Tokens" fill="#6c5ce7" />
                <Bar dataKey="outputTokens" stackId="tokens" name="Output Tokens" fill="#00cec9" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-bg3 bg-bg2 p-4">
          <h2 className="mb-4 text-lg font-semibold text-text">Cost by Model</h2>
          {modelUsage.length === 0 ? (
            <div className="flex h-80 items-center justify-center text-text2">No usage data yet.</div>
          ) : (
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={modelUsage}
                    dataKey="totalCost"
                    nameKey="model"
                    cx="50%"
                    cy="50%"
                    outerRadius={105}
                    innerRadius={60}
                    paddingAngle={2}
                  >
                    {modelUsage.map((entry, index) => (
                      <Cell key={`${entry.model}-${index}`} fill={pieColors[index % pieColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#12121a",
                      border: "1px solid #2c2c42",
                      borderRadius: "8px",
                      color: "#e8e8f0",
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-bg3 bg-bg2 p-4">
        <h2 className="mb-4 text-lg font-semibold text-text">Recent Usage</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-bg3 text-xs uppercase tracking-wide text-text2">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 font-medium">Input Tokens</th>
                <th className="px-3 py-2 font-medium">Output Tokens</th>
                <th className="px-3 py-2 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {recentUsage.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-text2" colSpan={5}>
                    No recent usage.
                  </td>
                </tr>
              ) : (
                recentUsage.map((entry, index) => (
                  <tr
                    key={`${entry.date}-${entry.model}-${entry.inputTokens}-${entry.outputTokens}-${index}`}
                    className="border-b border-bg3/70"
                  >
                    <td className="px-3 py-2 text-text2">{dateFormatter.format(new Date(entry.date))}</td>
                    <td className="px-3 py-2 text-text">{entry.model}</td>
                    <td className="px-3 py-2 text-text">{numberFormatter.format(entry.inputTokens)}</td>
                    <td className="px-3 py-2 text-text">{numberFormatter.format(entry.outputTokens)}</td>
                    <td className="px-3 py-2 text-text">{currencyFormatter.format(entry.cost)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
