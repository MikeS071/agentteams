"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AdminImpersonationBanner() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!session?.user?.impersonatedTenantId) {
    return null;
  }

  async function stopImpersonation() {
    setBusy(true);
    try {
      await update({ impersonatedTenantId: null });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-amber-400/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-100 sm:px-6">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <p>Impersonating tenant: {session.user.impersonatedTenantId}</p>
        <button
          type="button"
          disabled={busy}
          onClick={stopImpersonation}
          className="rounded border border-amber-300/40 px-2 py-1 text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
        >
          {busy ? "Stopping..." : "Stop impersonation"}
        </button>
      </div>
    </div>
  );
}
