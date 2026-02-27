import Link from "next/link";
import { notFound } from "next/navigation";
import pool from "@/lib/db";
import TenantUsageChart from "@/components/admin/TenantUsageChart";
import TenantActionButtons from "@/components/admin/TenantActionButtons";

type TenantDetail = {
  id: string;
  name: string | null;
  email: string;
  status: "active" | "paused" | "suspended";
  created_at: string | Date;
  balance_cents: number;
};

type UsagePoint = {
  day: string;
  cost_cents: number;
};

type TenantUser = {
  id: string;
  email: string;
  name: string | null;
  role: "user" | "admin" | "disabled";
};

type TenantAgent = {
  id: string;
  channel: "telegram" | "whatsapp";
  channel_user_id: string;
  muted: boolean;
  linked_at: string | Date;
};

type Deployment = {
  id: string;
  provider: "vercel" | "supabase";
  provider_user_id: string | null;
  connected_at: string | Date;
};

function formatDate(value: string | Date) {
  return new Date(value).toLocaleString();
}

export default async function AdminTenantDetailPage({
  params,
}: {
  params: { tenantId: string };
}) {
  const tenantId = params.tenantId;

  const [tenantResult, usageResult, usersResult, agentsResult, deploymentsResult] = await Promise.all([
    pool.query<TenantDetail>(
      `
      SELECT t.id, u.name, u.email, t.status, t.created_at, COALESCE(c.balance_cents, 0) AS balance_cents
      FROM tenants t
      JOIN users u ON u.id = t.user_id
      LEFT JOIN credits c ON c.tenant_id = t.id
      WHERE t.id = $1
      `,
      [tenantId]
    ),
    pool.query<UsagePoint>(
      `
      SELECT TO_CHAR(created_at::date, 'YYYY-MM-DD') AS day, COALESCE(SUM(cost_cents), 0) AS cost_cents
      FROM usage_logs
      WHERE tenant_id = $1
        AND created_at >= NOW() - INTERVAL '14 days'
      GROUP BY created_at::date
      ORDER BY created_at::date ASC
      `,
      [tenantId]
    ),
    pool.query<TenantUser>(
      `
      SELECT u.id, u.email, u.name, u.role
      FROM users u
      JOIN tenants t ON t.user_id = u.id
      WHERE t.id = $1
      `,
      [tenantId]
    ),
    pool.query<TenantAgent>(
      `
      SELECT id, channel, channel_user_id, muted, linked_at
      FROM tenant_channels
      WHERE tenant_id = $1
      ORDER BY linked_at DESC
      `,
      [tenantId]
    ),
    pool.query<Deployment>(
      `
      SELECT id, provider, provider_user_id, connected_at
      FROM deploy_connections
      WHERE tenant_id = $1
      ORDER BY connected_at DESC
      `,
      [tenantId]
    ),
  ]);

  const tenant = tenantResult.rows[0];
  if (!tenant) {
    notFound();
  }

  const usageData = usageResult.rows.map((row) => ({
    day: row.day.slice(5),
    costCents: Number(row.cost_cents),
  }));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/tenants" className="text-sm text-gray-400 hover:text-gray-200">
            ← Back to tenants
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-gray-100">{tenant.name || tenant.email}</h1>
          <p className="text-sm text-gray-400">Tenant ID: {tenant.id}</p>
        </div>
        <TenantActionButtons tenantId={tenant.id} status={tenant.status} />
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-[#1f1f30] bg-[#121220] p-4">
          <p className="text-xs uppercase text-gray-400">Status</p>
          <p className="mt-2 text-xl font-semibold text-gray-100">{tenant.status}</p>
        </div>
        <div className="rounded-xl border border-[#1f1f30] bg-[#121220] p-4">
          <p className="text-xs uppercase text-gray-400">Credit Balance</p>
          <p className="mt-2 text-xl font-semibold text-gray-100">
            ${(tenant.balance_cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="rounded-xl border border-[#1f1f30] bg-[#121220] p-4">
          <p className="text-xs uppercase text-gray-400">Created</p>
          <p className="mt-2 text-sm font-medium text-gray-200">{formatDate(tenant.created_at)}</p>
        </div>
      </section>

      <section className="rounded-xl border border-[#1f1f30] bg-[#121220] p-5">
        <h2 className="text-lg font-medium text-gray-100">Usage (14 days)</h2>
        <div className="mt-4">
          {usageData.length === 0 ? (
            <p className="text-sm text-gray-400">No usage data available.</p>
          ) : (
            <TenantUsageChart data={usageData} />
          )}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-[#1f1f30] bg-[#121220] p-5">
          <h2 className="text-lg font-medium text-gray-100">Users</h2>
          <div className="mt-4 space-y-3">
            {usersResult.rows.map((user) => (
              <div key={user.id} className="rounded-lg border border-[#252538] bg-[#10101a] px-3 py-2">
                <p className="text-sm text-gray-200">{user.name || user.email}</p>
                <p className="text-xs text-gray-400">{user.email}</p>
                <p className="mt-1 text-xs text-gray-500">Role: {user.role}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-xl border border-[#1f1f30] bg-[#121220] p-5">
          <h2 className="text-lg font-medium text-gray-100">Agent List</h2>
          <div className="mt-4 space-y-3">
            {agentsResult.rows.length === 0 ? (
              <p className="text-sm text-gray-400">No linked agents.</p>
            ) : (
              agentsResult.rows.map((agent) => (
                <div key={agent.id} className="rounded-lg border border-[#252538] bg-[#10101a] px-3 py-2">
                  <p className="text-sm capitalize text-gray-200">{agent.channel}</p>
                  <p className="text-xs text-gray-400">Channel user: {agent.channel_user_id}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {agent.muted ? "Muted" : "Active"} · Linked {formatDate(agent.linked_at)}
                  </p>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="rounded-xl border border-[#1f1f30] bg-[#121220] p-5">
        <h2 className="text-lg font-medium text-gray-100">Deployment Status</h2>
        <div className="mt-4 space-y-3">
          {deploymentsResult.rows.length === 0 ? (
            <p className="text-sm text-gray-400">No deployment integrations connected.</p>
          ) : (
            deploymentsResult.rows.map((deployment) => (
              <div key={deployment.id} className="rounded-lg border border-[#252538] bg-[#10101a] px-3 py-2">
                <p className="text-sm capitalize text-gray-200">{deployment.provider}</p>
                {deployment.provider_user_id ? (
                  <p className="text-xs text-gray-400">Account: {deployment.provider_user_id}</p>
                ) : null}
                <p className="mt-1 text-xs text-gray-500">Connected {formatDate(deployment.connected_at)}</p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
