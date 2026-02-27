import Link from "next/link";
import pool from "@/lib/db";
import TenantActionButtons from "@/components/admin/TenantActionButtons";

type TenantRow = {
  id: string;
  name: string | null;
  email: string;
  plan: string;
  credit_balance_cents: number;
  active_agents: string;
  status: "active" | "paused" | "suspended";
  created_at: string | Date;
};

function formatDate(value: string | Date) {
  return new Date(value).toLocaleDateString();
}

export default async function AdminTenantsPage() {
  const result = await pool.query<TenantRow>(`
    SELECT
      t.id,
      u.name,
      u.email,
      CASE WHEN c.free_credit_used THEN 'Paid' ELSE 'Starter' END AS plan,
      COALESCE(c.balance_cents, 0) AS credit_balance_cents,
      (
        SELECT COUNT(*)
        FROM tenant_channels tc
        WHERE tc.tenant_id = t.id AND tc.muted = FALSE
      )::text AS active_agents,
      t.status,
      t.created_at
    FROM tenants t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN credits c ON c.tenant_id = t.id
    ORDER BY t.created_at DESC
  `);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-gray-100">Tenants</h1>
        <p className="mt-1 text-sm text-gray-400">Manage tenant lifecycle, credit balances, and impersonation.</p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#1f1f30] bg-[#121220]">
        <table className="min-w-full divide-y divide-[#27273a]">
          <thead className="bg-[#151523]">
            <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3">Tenant</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Credit Balance</th>
              <th className="px-4 py-3">Active Agents</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#27273a]">
            {result.rows.map((tenant) => (
              <tr key={tenant.id} className="text-sm text-gray-200">
                <td className="px-4 py-3">
                  <Link href={`/admin/tenants/${tenant.id}`} className="font-medium text-[#9da3ff] hover:underline">
                    {tenant.name || tenant.email}
                  </Link>
                  <p className="text-xs text-gray-400">{tenant.email}</p>
                  <p className="mt-1 text-xs text-gray-500">Status: {tenant.status}</p>
                </td>
                <td className="px-4 py-3 text-gray-300">{tenant.plan}</td>
                <td className="px-4 py-3 text-gray-300">
                  ${(tenant.credit_balance_cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-3 text-gray-300">{Number(tenant.active_agents)}</td>
                <td className="px-4 py-3 text-gray-300">{formatDate(tenant.created_at)}</td>
                <td className="px-4 py-3">
                  <TenantActionButtons tenantId={tenant.id} status={tenant.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
