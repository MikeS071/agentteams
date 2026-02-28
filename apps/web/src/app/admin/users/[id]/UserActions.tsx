"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type UserActionsProps = {
  userId: string;
  status: "active" | "suspended";
  role: "user" | "admin";
};

export default function UserActions({ userId, status, role }: UserActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [nextRole, setNextRole] = useState<"user" | "admin">(role);
  const [amountCents, setAmountCents] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const suspendLabel = useMemo(() => (status === "suspended" ? "Unsuspend" : "Suspend"), [status]);

  async function callApi(method: "PATCH" | "DELETE", payload?: unknown) {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method,
        headers: payload ? { "Content-Type": "application/json" } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Request failed");
      }

      return response;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4">
      <h2 className="text-lg font-semibold text-white">Actions</h2>

      <button
        className="w-full rounded-md bg-[#6c5ce7] px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        disabled={busy}
        onClick={async () => {
          try {
            await callApi("PATCH", { action: "suspend", suspended: status !== "suspended" });
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update status");
          }
        }}
        type="button"
      >
        {suspendLabel} User
      </button>

      <div className="space-y-2">
        <label className="block text-xs uppercase tracking-wide text-gray-400">Role</label>
        <div className="flex gap-2">
          <select
            value={nextRole}
            onChange={(event) => setNextRole(event.target.value as "user" | "admin")}
            className="flex-1 rounded-md border border-[#24243a] bg-[#0d0d14] px-3 py-2 text-sm text-gray-100"
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
          <button
            className="rounded-md border border-[#3f3f62] px-3 py-2 text-sm text-gray-100 disabled:opacity-60"
            disabled={busy || nextRole === role}
            onClick={async () => {
              try {
                await callApi("PATCH", { action: "changeRole", role: nextRole });
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to update role");
              }
            }}
            type="button"
          >
            Save Role
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-xs uppercase tracking-wide text-gray-400">Adjust Credits (cents)</label>
        <input
          type="number"
          placeholder="e.g. 1000 or -500"
          value={amountCents}
          onChange={(event) => setAmountCents(event.target.value)}
          className="w-full rounded-md border border-[#24243a] bg-[#0d0d14] px-3 py-2 text-sm text-gray-100"
        />
        <input
          type="text"
          placeholder="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="w-full rounded-md border border-[#24243a] bg-[#0d0d14] px-3 py-2 text-sm text-gray-100"
        />
        <button
          className="w-full rounded-md border border-[#3f3f62] px-3 py-2 text-sm text-gray-100 disabled:opacity-60"
          disabled={busy || !amountCents || !reason.trim()}
          onClick={async () => {
            try {
              await callApi("PATCH", {
                action: "adjustCredits",
                amountCents: Number.parseInt(amountCents, 10),
                reason,
              });
              setAmountCents("");
              setReason("");
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to adjust credits");
            }
          }}
          type="button"
        >
          Apply Credit Adjustment
        </button>
      </div>

      <button
        className="w-full rounded-md bg-red-600/80 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        disabled={busy}
        onClick={async () => {
          const approved = window.confirm("Soft-delete this user? This action can only be undone manually in the database.");
          if (!approved) return;

          try {
            await callApi("DELETE");
            router.push("/admin/users");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to delete user");
          }
        }}
        type="button"
      >
        Delete User
      </button>

      {error && <p className="text-sm text-red-300">{error}</p>}
    </div>
  );
}
