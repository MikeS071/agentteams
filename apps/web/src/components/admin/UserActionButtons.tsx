"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type UserActionButtonsProps = {
  userId: string;
  role: "user" | "admin" | "disabled";
};

export default function UserActionButtons({ userId, role }: UserActionButtonsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();

  async function post(path: string, body: Record<string, unknown>) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || "Request failed");
    }
    return res;
  }

  async function toggleDisable() {
    setBusy("disable");
    try {
      await post(`/api/admin/users/${userId}/disable`, {
        disabled: role !== "disabled",
      });
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  async function changeRole() {
    const nextRole = window.prompt("Set role to: user, admin, or disabled", role);
    if (!nextRole) return;
    if (!["user", "admin", "disabled"].includes(nextRole)) {
      window.alert("Invalid role.");
      return;
    }

    setBusy("role");
    try {
      await post(`/api/admin/users/${userId}/role`, { role: nextRole });
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  async function resetPassword() {
    setBusy("password");
    try {
      const res = await post(`/api/admin/users/${userId}/reset-password`, {});
      const payload = (await res.json()) as { temporaryPassword: string };
      window.alert(`Temporary password: ${payload.temporaryPassword}`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={busy !== null}
        onClick={toggleDisable}
        className="rounded-md border border-[#303048] px-3 py-1.5 text-xs text-gray-200 hover:bg-[#171725] disabled:opacity-50"
      >
        {busy === "disable" ? "Saving..." : role === "disabled" ? "Enable" : "Disable"}
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={changeRole}
        className="rounded-md border border-[#303048] px-3 py-1.5 text-xs text-gray-200 hover:bg-[#171725] disabled:opacity-50"
      >
        {busy === "role" ? "Saving..." : "Change Role"}
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={resetPassword}
        className="rounded-md border border-[#303048] px-3 py-1.5 text-xs text-gray-200 hover:bg-[#171725] disabled:opacity-50"
      >
        {busy === "password" ? "Resetting..." : "Reset Password"}
      </button>
    </div>
  );
}
