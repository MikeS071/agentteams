import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin-auth";
import { getAdminUserDetail } from "@/lib/admin-user-detail";
import UserUsageChart from "@/components/admin/UserUsageChart";
import UserActions from "./UserActions";

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getAdminSession();

  if (!session?.user) {
    redirect("/login");
  }

  const detail = await getAdminUserDetail(params.id);
  if (!detail) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">User Detail</p>
          <h1 className="text-2xl font-semibold text-white">{detail.profile.email}</h1>
        </div>
        <Link href="/admin/users" className="rounded-md border border-[#3f3f62] px-3 py-2 text-sm text-gray-200">
          Back to Users
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <section className="rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4">
            <h2 className="mb-3 text-lg font-semibold text-white">Profile</h2>
            <div className="grid gap-3 text-sm text-gray-300 sm:grid-cols-2">
              <p>Email: <span className="text-gray-100">{detail.profile.email}</span></p>
              <p>Name: <span className="text-gray-100">{detail.profile.name || "-"}</span></p>
              <p>Tenant: <span className="text-gray-100">{detail.profile.tenantId || "-"}</span></p>
              <p>Role: <span className="text-gray-100">{detail.profile.role}</span></p>
              <p>Status: <span className="text-gray-100">{detail.profile.status}</span></p>
              <p>Signup Date: <span className="text-gray-100">{formatDateTime(detail.profile.signupDate)}</span></p>
              <p>Last Active: <span className="text-gray-100">{formatDateTime(detail.profile.lastActive)}</span></p>
            </div>
          </section>

          <section className="rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4">
            <h2 className="mb-3 text-lg font-semibold text-white">Usage History (Last 30 Days)</h2>
            <UserUsageChart data={detail.usage} />
          </section>

          <section className="rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4">
            <h2 className="mb-3 text-lg font-semibold text-white">Connected Channels</h2>
            <div className="space-y-2 text-sm text-gray-300">
              {detail.channels.map((channel) => (
                <div key={channel.id} className="flex items-center justify-between rounded-md border border-[#25253b] px-3 py-2">
                  <p>
                    <span className="font-medium text-gray-100">{channel.channel}</span> / {channel.channel_user_id}
                  </p>
                  <p>{channel.muted ? "Muted" : "Active"}</p>
                </div>
              ))}
              {detail.channels.length === 0 && <p className="text-gray-400">No channels connected.</p>}
            </div>
          </section>

          <section className="rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4">
            <h2 className="mb-3 text-lg font-semibold text-white">Credit Balance</h2>
            <p className="mb-3 text-xl font-semibold text-emerald-300">{formatMoney(detail.credits.balanceCents)}</p>
            <div className="overflow-x-auto rounded-lg border border-[#1d1d2c]">
              <table className="min-w-full text-sm text-gray-300">
                <thead className="bg-[#0f0f18] text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Amount</th>
                    <th className="px-3 py-2">Reason</th>
                    <th className="px-3 py-2">Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.credits.transactions.map((row) => (
                    <tr key={row.id} className="border-t border-[#1d1d2c]">
                      <td className="px-3 py-2">{formatDateTime(row.created_at)}</td>
                      <td className={`px-3 py-2 ${row.amount_cents >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                        {row.amount_cents >= 0 ? "+" : ""}
                        {formatMoney(row.amount_cents)}
                      </td>
                      <td className="px-3 py-2">{row.reason}</td>
                      <td className="px-3 py-2">{row.admin_email || "-"}</td>
                    </tr>
                  ))}
                  {detail.credits.transactions.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-center text-gray-400" colSpan={4}>
                        No transactions yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-xl border border-[#1d1d2c] bg-[#11111a] p-4">
            <h2 className="mb-3 text-lg font-semibold text-white">Container Health</h2>
            {detail.container ? (
              <div className="space-y-2 text-sm text-gray-300">
                <p>Container ID: <span className="text-gray-100">{detail.container.containerId}</span></p>
                <p>Status: <span className="text-gray-100">{detail.container.status || "unknown"}</span></p>
              </div>
            ) : (
              <p className="text-sm text-gray-400">No container is configured for this tenant.</p>
            )}
          </section>

          <UserActions
            role={detail.profile.role}
            status={detail.profile.status}
            userId={detail.profile.id}
          />
        </div>
      </div>
    </div>
  );
}
