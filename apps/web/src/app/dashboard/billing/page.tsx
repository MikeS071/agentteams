"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type BalanceResponse = {
  balanceCents: number;
  initialCreditCents: number;
  remainingPct: number;
};

type DailyUsage = {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
};

type ModelUsage = {
  model: string;
  totalTokens: number;
  costCents: number;
};

type AgentUsage = {
  agent: string;
  messageCount: number;
};

type BillingTransaction = {
  date: string;
  type: "grant" | "purchase" | "usage";
  amountCents: number;
  balanceAfterCents: number;
  description: string;
};

type UsageResponse = {
  daily: DailyUsage[];
  byModel: ModelUsage[];
  byAgent: AgentUsage[];
  transactions: BillingTransaction[];
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const numberFormatter = new Intl.NumberFormat("en-US");

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const pieColors = ["#6c5ce7", "#00cec9", "#a29bfe", "#55efc4", "#fdcb6e", "#e17055", "#74b9ff"];
const topUpPacks = [
  { amount: 10, label: "Starter", tokens: "~1M tokens" },
  { amount: 25, label: "Builder", tokens: "~3M tokens" },
  { amount: 50, label: "Scale", tokens: "~7M tokens" },
  { amount: 100, label: "Max", tokens: "~15M tokens" },
];

function getBalanceClass(remainingPct: number): string {
  if (remainingPct > 50) return "text-emerald-400";
  if (remainingPct >= 20) return "text-amber-400";
  return "text-red-400";
}

function shortDayLabel(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return date.slice(5);
  }
  return dayFormatter.format(parsed);
}

function typeBadge(type: BillingTransaction["type"]): string {
  if (type === "purchase") return "bg-sky-500/15 text-sky-300 border-sky-500/30";
  if (type === "grant") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  return "bg-rose-500/15 text-rose-300 border-rose-500/30";
}

export default function BillingPage() {
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<number | null>(null);
  const [checkoutError, setCheckoutError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const [balanceRes, usageRes] = await Promise.all([
          fetch("/api/billing/balance", { cache: "no-store" }),
          fetch("/api/billing/usage", { cache: "no-store" }),
        ]);

        if (!balanceRes.ok || !usageRes.ok) {
          throw new Error("Failed to load billing data");
        }

        const [balancePayload, usagePayload] = await Promise.all([
          balanceRes.json() as Promise<BalanceResponse>,
          usageRes.json() as Promise<UsageResponse>,
        ]);

        if (!mounted) return;
        setBalance(balancePayload);
        setUsage(usagePayload);
      } catch (loadError) {
        console.error(loadError);
        if (mounted) {
          setError("Unable to load billing dashboard.");
        }
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

  async function startCheckout(amount: number) {
    setCheckoutError("");
    setCheckoutLoading(amount);

    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });

      const payload = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Checkout failed");
      }

      window.location.href = payload.url;
    } catch (checkoutLoadError) {
      const message = checkoutLoadError instanceof Error ? checkoutLoadError.message : "Unable to start checkout";
      setCheckoutError(message);
      setCheckoutLoading(null);
    }
  }

  const chartData = useMemo(() => {
    return (usage?.daily ?? []).map((item) => ({
      ...item,
      day: shortDayLabel(item.date),
    }));
  }, [usage]);

  if (loading) {
    return <div className="p-6 text-sm text-gray-400">Loading billing dashboard...</div>;
  }

  if (error || !balance || !usage) {
    return <div className="m-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error ?? "No billing data found."}</div>;
  }

  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="rounded-2xl border border-[#2a2a3d] bg-[#12121f] p-6">
          <p className="text-xs uppercase tracking-[0.16em] text-[#a0a0b8]">Current credit balance</p>
          <p className={`mt-3 text-4xl font-bold sm:text-5xl ${getBalanceClass(balance.remainingPct)}`}>
            {currencyFormatter.format(balance.balanceCents / 100)}
          </p>
          <p className="mt-2 text-sm text-[#a0a0b8]">{balance.remainingPct.toFixed(1)}% remaining</p>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <article className="rounded-2xl border border-[#2a2a3d] bg-[#12121f] p-5">
            <h2 className="text-base font-semibold text-[#e8e8f0]">Daily Token Usage (Last 30 Days)</h2>
            <div className="mt-4 h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid stroke="#2a2a3d" strokeDasharray="3 3" />
                  <XAxis dataKey="day" stroke="#a0a0b8" tickLine={false} axisLine={false} />
                  <YAxis stroke="#a0a0b8" tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f0f19",
                      border: "1px solid #2a2a3d",
                      borderRadius: "10px",
                      color: "#e8e8f0",
                    }}
                  />
                  <Line type="monotone" dataKey="inputTokens" stroke="#6c5ce7" strokeWidth={2} dot={false} name="Input" />
                  <Line type="monotone" dataKey="outputTokens" stroke="#00cec9" strokeWidth={2} dot={false} name="Output" />
                  <Line type="monotone" dataKey="totalTokens" stroke="#a29bfe" strokeWidth={2} dot={false} name="Total" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="rounded-2xl border border-[#2a2a3d] bg-[#12121f] p-5">
            <h2 className="text-base font-semibold text-[#e8e8f0]">Usage Breakdown by Model</h2>
            {usage.byModel.length === 0 ? (
              <div className="mt-4 text-sm text-[#a0a0b8]">No model usage yet.</div>
            ) : (
              <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={usage.byModel} dataKey="costCents" nameKey="model" innerRadius={55} outerRadius={100} paddingAngle={2}>
                        {usage.byModel.map((entry, index) => (
                          <Cell key={`${entry.model}-${index}`} fill={pieColors[index % pieColors.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f0f19",
                          border: "1px solid #2a2a3d",
                          borderRadius: "10px",
                          color: "#e8e8f0",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-[#a0a0b8]">
                      <tr>
                        <th className="pb-2 pr-3 font-medium">Model</th>
                        <th className="pb-2 pr-3 font-medium">Tokens</th>
                        <th className="pb-2 font-medium">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.byModel.map((row) => (
                        <tr key={row.model} className="border-t border-[#2a2a3d]">
                          <td className="py-2 pr-3">{row.model}</td>
                          <td className="py-2 pr-3 text-[#a0a0b8]">{numberFormatter.format(row.totalTokens)}</td>
                          <td className="py-2">{currencyFormatter.format(row.costCents / 100)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </article>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <article className="rounded-2xl border border-[#2a2a3d] bg-[#12121f] p-5">
            <h2 className="text-base font-semibold text-[#e8e8f0]">Usage Breakdown by Hand/Agent</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-[#a0a0b8]">
                  <tr>
                    <th className="pb-2 pr-3 font-medium">Hand/Agent</th>
                    <th className="pb-2 font-medium">Messages</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.byAgent.map((row) => (
                    <tr key={row.agent} className="border-t border-[#2a2a3d]">
                      <td className="py-2 pr-3">{row.agent}</td>
                      <td className="py-2">{numberFormatter.format(row.messageCount)}</td>
                    </tr>
                  ))}
                  {usage.byAgent.length === 0 && (
                    <tr>
                      <td className="py-3 text-[#a0a0b8]" colSpan={2}>
                        No hand/agent activity yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <article className="rounded-2xl border border-[#2a2a3d] bg-[#12121f] p-5">
            <h2 className="text-base font-semibold text-[#e8e8f0]">Buy Credits</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {topUpPacks.map((pack) => (
                <button
                  type="button"
                  key={pack.amount}
                  onClick={() => startCheckout(pack.amount)}
                  disabled={checkoutLoading !== null}
                  className="rounded-xl border border-[#2a2a3d] bg-[#16162a] p-4 text-left transition hover:border-[#6c5ce7] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <p className="text-xs uppercase tracking-wide text-[#a29bfe]">{pack.label}</p>
                  <p className="mt-1 text-2xl font-bold text-[#e8e8f0]">${pack.amount}</p>
                  <p className="mt-1 text-sm text-[#a0a0b8]">{pack.tokens}</p>
                  <p className="mt-3 text-sm text-[#00cec9]">
                    {checkoutLoading === pack.amount ? "Redirecting..." : "Checkout via Stripe"}
                  </p>
                </button>
              ))}
            </div>
            {checkoutError && <p className="mt-3 text-sm text-red-300">{checkoutError}</p>}
          </article>
        </section>

        <section className="rounded-2xl border border-[#2a2a3d] bg-[#12121f] p-5">
          <h2 className="text-base font-semibold text-[#e8e8f0]">Transaction History</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-[#a0a0b8]">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Date</th>
                  <th className="pb-2 pr-4 font-medium">Type</th>
                  <th className="pb-2 pr-4 font-medium">Amount</th>
                  <th className="pb-2 font-medium">Balance After</th>
                </tr>
              </thead>
              <tbody>
                {usage.transactions.map((row, index) => (
                  <tr key={`${row.date}-${row.type}-${index}`} className="border-t border-[#2a2a3d]">
                    <td className="py-2 pr-4 text-[#a0a0b8]">{dateTimeFormatter.format(new Date(row.date))}</td>
                    <td className="py-2 pr-4">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${typeBadge(row.type)}`}>
                        {row.type}
                      </span>
                    </td>
                    <td className={`py-2 pr-4 ${row.amountCents >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                      {row.amountCents >= 0 ? "+" : "-"}
                      {currencyFormatter.format(Math.abs(row.amountCents) / 100)}
                    </td>
                    <td className="py-2">{currencyFormatter.format(row.balanceAfterCents / 100)}</td>
                  </tr>
                ))}
                {usage.transactions.length === 0 && (
                  <tr>
                    <td className="py-3 text-[#a0a0b8]" colSpan={4}>
                      No transactions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
