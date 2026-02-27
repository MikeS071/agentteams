"use client";

import { useEffect, useState } from "react";

type BalanceResponse = {
  balanceCents: number;
  initialCreditCents: number;
  remainingPct: number;
};

function getBalanceClasses(remainingPct: number): string {
  if (remainingPct > 50) {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  }

  if (remainingPct >= 10) {
    return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  }

  return "border-red-500/40 bg-red-500/10 text-red-300";
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function DashboardBalance() {
  const [balance, setBalance] = useState<BalanceResponse | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadBalance() {
      try {
        const response = await fetch("/api/billing/balance", { cache: "no-store" });
        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as BalanceResponse;
        if (isMounted) {
          setBalance(data);
        }
      } catch (error) {
        console.error("Failed to load dashboard balance:", error);
      }
    }

    loadBalance();

    return () => {
      isMounted = false;
    };
  }, []);

  if (!balance) {
    return (
      <div className="rounded-lg border border-bg3 bg-bg2 px-3 py-2 text-sm text-text2">
        Balance...
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border px-3 py-2 text-sm font-medium ${getBalanceClasses(balance.remainingPct)}`}
    >
      Balance: {currencyFormatter.format(balance.balanceCents / 100)}
    </div>
  );
}
