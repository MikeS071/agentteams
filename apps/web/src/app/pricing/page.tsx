"use client";

import Link from "next/link";
import { useState } from "react";

type Tier = {
  name: string;
  price: string;
  subtitle: string;
  tokens: string;
  agents: string;
  tools: string;
  support: string;
  channels: string;
  ctaLabel: string;
  ctaType: "signup" | "checkout" | "contact";
  checkoutAmount?: number;
  featured?: boolean;
};

type CreditPack = {
  label: string;
  amount: number;
  tokens: string;
  bonus?: string;
};

const TIERS: Tier[] = [
  {
    name: "Free",
    price: "$0",
    subtitle: "Get started at zero cost",
    tokens: "1M tokens",
    agents: "1 agent",
    tools: "Basic tools",
    support: "Community support",
    channels: "Web",
    ctaLabel: "Start Free",
    ctaType: "signup",
  },
  {
    name: "Pro",
    price: "$25/mo",
    subtitle: "For builders running serious workloads",
    tokens: "5M tokens",
    agents: "All agents",
    tools: "All tools",
    support: "Priority support",
    channels: "Web + Telegram + WhatsApp",
    ctaLabel: "Go Pro",
    ctaType: "checkout",
    checkoutAmount: 25,
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    subtitle: "Security, scale, and dedicated support",
    tokens: "Custom token pools",
    agents: "All agents + private agents",
    tools: "All tools + custom integrations",
    support: "Dedicated support + SLA",
    channels: "All channels + API",
    ctaLabel: "Contact Sales",
    ctaType: "contact",
  },
];

const CREDIT_PACKAGES: CreditPack[] = [
  { label: "Starter Pack", amount: 10, tokens: "1M tokens" },
  { label: "Builder Pack", amount: 25, tokens: "3M tokens", bonus: "Best value" },
  { label: "Scale Pack", amount: 50, tokens: "7M tokens" },
];

const COMPARE_ROWS = [
  { feature: "Agents", free: "1 agent", pro: "All agents", enterprise: "All + private agents" },
  { feature: "Tools", free: "Basic tools", pro: "All tools", enterprise: "All + custom integrations" },
  { feature: "Support", free: "Community", pro: "Priority", enterprise: "Dedicated + SLA" },
  { feature: "Channels", free: "Web", pro: "Web + Telegram + WhatsApp", enterprise: "All + API" },
] as const;

export default function PricingPage() {
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function startCheckout(amount: number, key: string) {
    setError("");
    setLoadingKey(key);

    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });

      const payload = (await response.json()) as { error?: string; url?: string };

      if (response.status === 401) {
        window.location.href = "/signup";
        return;
      }

      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Unable to create checkout session");
      }

      window.location.href = payload.url;
    } catch (checkoutError) {
      const message =
        checkoutError instanceof Error
          ? checkoutError.message
          : "Unable to start checkout";
      setError(message);
      setLoadingKey(null);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-bg px-4 py-16 text-text sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-[8%] top-0 h-72 w-72 rounded-full bg-accent/15 blur-3xl" />
        <div className="absolute right-[12%] top-[10%] h-64 w-64 rounded-full bg-accent3/10 blur-3xl" />
      </div>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-16">
        <section className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-bg3 bg-bg2 px-4 py-1 text-xs uppercase tracking-[0.18em] text-accent2">
            <span className="h-2 w-2 rounded-full bg-accent3" />
            Pricing
          </div>
          <h1 className="mt-6 bg-gradient-to-r from-text via-accent2 to-accent3 bg-clip-text text-4xl font-black leading-tight text-transparent sm:text-5xl">
            Choose a plan, then scale with credits.
          </h1>
          <p className="mx-auto mt-4 max-w-3xl text-sm text-text2 sm:text-base">
            Start free with 1M tokens, upgrade to Pro for priority workflows, or
            buy one-time credit packs when you need extra throughput.
          </p>
        </section>

        <section>
          <div className="grid gap-5 md:grid-cols-3">
            {TIERS.map((tier) => (
              <article
                key={tier.name}
                className={`overflow-hidden rounded-2xl border bg-[#16162a] ${
                  tier.featured
                    ? "border-accent shadow-[0_0_0_1px_rgba(108,92,231,0.25)]"
                    : "border-[#2a2a3e]"
                }`}
              >
                <div className="flex items-center gap-1.5 border-b border-[#2a2a3e] bg-bg3 px-4 py-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                  <span className="ml-2 text-xs font-mono text-text2">plan/{tier.name.toLowerCase()}</span>
                </div>
                <div className="space-y-5 p-6">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-accent2">{tier.name}</p>
                    <p className="mt-2 text-4xl font-extrabold">{tier.price}</p>
                    <p className="mt-2 text-sm text-text2">{tier.subtitle}</p>
                  </div>

                  <ul className="space-y-2 text-sm text-text2">
                    <li>{tier.tokens}</li>
                    <li>{tier.agents}</li>
                    <li>{tier.tools}</li>
                    <li>{tier.support}</li>
                    <li>{tier.channels}</li>
                  </ul>

                  {tier.ctaType === "signup" && (
                    <Link
                      href="/signup"
                      className="inline-flex w-full items-center justify-center rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#7a6af1]"
                    >
                      {tier.ctaLabel}
                    </Link>
                  )}

                  {tier.ctaType === "checkout" && tier.checkoutAmount && (
                    <button
                      type="button"
                      onClick={() =>
                        startCheckout(
                          tier.checkoutAmount!,
                          `tier-${tier.name.toLowerCase()}`
                        )
                      }
                      disabled={loadingKey !== null}
                      className="inline-flex w-full items-center justify-center rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#7a6af1] disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {loadingKey === `tier-${tier.name.toLowerCase()}`
                        ? "Redirecting..."
                        : `${tier.ctaLabel} via Stripe`}
                    </button>
                  )}

                  {tier.ctaType === "contact" && (
                    <a
                      href="mailto:sales@agentsquads.ai?subject=Enterprise%20Plan"
                      className="inline-flex w-full items-center justify-center rounded-lg border border-[#2f2f45] bg-bg px-4 py-2.5 text-sm font-semibold text-text transition hover:border-accent2"
                    >
                      {tier.ctaLabel}
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-accent2">One-time credits</p>
              <h2 className="mt-2 text-2xl font-bold">Top up token balance instantly</h2>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CREDIT_PACKAGES.map((pack) => (
              <article
                key={pack.label}
                className="rounded-2xl border border-[#2a2a3e] bg-[#141425] p-5"
              >
                <p className="text-sm font-semibold">{pack.label}</p>
                <p className="mt-3 text-3xl font-bold">${pack.amount}</p>
                <p className="mt-1 text-sm text-text2">{pack.tokens}</p>
                {pack.bonus && (
                  <p className="mt-3 inline-flex rounded-full border border-accent/50 bg-accent/10 px-2.5 py-0.5 text-xs text-accent2">
                    {pack.bonus}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => startCheckout(pack.amount, `pack-${pack.amount}`)}
                  disabled={loadingKey !== null}
                  className="mt-5 inline-flex w-full items-center justify-center rounded-lg border border-[#2f2f45] bg-bg px-4 py-2.5 text-sm font-semibold text-text transition hover:border-accent2 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {loadingKey === `pack-${pack.amount}`
                    ? "Redirecting..."
                    : `Checkout $${pack.amount}`}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-[#2a2a3e] bg-[#12121f] p-5 sm:p-6">
          <div className="mb-4">
            <p className="text-xs uppercase tracking-[0.16em] text-accent2">Feature comparison</p>
            <h2 className="mt-2 text-2xl font-bold">What you get per tier</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#2a2a3e] text-text2">
                  <th className="px-3 py-3 font-medium">Feature</th>
                  <th className="px-3 py-3 font-medium">Free</th>
                  <th className="px-3 py-3 font-medium">Pro</th>
                  <th className="px-3 py-3 font-medium">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((row) => (
                  <tr key={row.feature} className="border-b border-[#242438] last:border-0">
                    <td className="px-3 py-3 font-semibold">{row.feature}</td>
                    <td className="px-3 py-3 text-text2">{row.free}</td>
                    <td className="px-3 py-3 text-text2">{row.pro}</td>
                    <td className="px-3 py-3 text-text2">{row.enterprise}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {error && (
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
