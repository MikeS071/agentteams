"use client";

import { useState } from "react";

const AMOUNTS = [10, 25, 50, 100];

export default function BillingCheckoutButtons() {
  const [loadingAmount, setLoadingAmount] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function startCheckout(amount: number) {
    setError("");
    setLoadingAmount(amount);

    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });

      const data = (await res.json()) as { error?: string; url?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Checkout failed");
      }

      window.location.href = data.url;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to start checkout";
      setError(message);
      setLoadingAmount(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {AMOUNTS.map((amount) => (
          <button
            key={amount}
            onClick={() => startCheckout(amount)}
            disabled={loadingAmount !== null}
            className="rounded-lg border border-bg3 bg-bg px-4 py-3 text-sm font-medium text-text hover:bg-bg3 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loadingAmount === amount ? "Redirecting..." : `Buy $${amount}`}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
