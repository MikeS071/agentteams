"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type TenantActionButtonsProps = {
  tenantId: string;
  status: "active" | "paused" | "suspended";
};

export default function TenantActionButtons({ tenantId, status }: TenantActionButtonsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();
  const { update } = useSession();

  async function toggleSuspend() {
    setBusy("status");
    try {
      const nextStatus = status === "suspended" ? "active" : "suspended";
      await fetch(`/api/admin/tenants/${tenantId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function adjustCredits() {
    const input = window.prompt("Credit adjustment in dollars (negative allowed):", "10");
    if (!input) return;
    const deltaDollars = Number(input);
    if (!Number.isFinite(deltaDollars)) {
      window.alert("Invalid number.");
      return;
    }
    setBusy("credits");
    try {
      await fetch(`/api/admin/tenants/${tenantId}/credits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deltaCents: Math.round(deltaDollars * 100) }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function impersonateTenant() {
    setBusy("impersonate");
    try {
      await update({ impersonatedTenantId: tenantId });
      router.push("/dashboard/chat");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={busy !== null}
        onClick={toggleSuspend}
        className="rounded-md border border-[#303048] px-3 py-1.5 text-xs text-gray-200 hover:bg-[#171725] disabled:opacity-50"
      >
        {busy === "status" ? "Saving..." : status === "suspended" ? "Unsuspend" : "Suspend"}
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={adjustCredits}
        className="rounded-md border border-[#303048] px-3 py-1.5 text-xs text-gray-200 hover:bg-[#171725] disabled:opacity-50"
      >
        {busy === "credits" ? "Saving..." : "Adjust Credits"}
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={impersonateTenant}
        className="rounded-md bg-[#5a4dd6] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy === "impersonate" ? "Starting..." : "Impersonate"}
      </button>
    </div>
  );
}
