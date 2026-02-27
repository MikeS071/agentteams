import pool from "@/lib/db";

type OverviewStats = {
  total_tenants: string;
  active_tenants: string;
  total_revenue_cents: string;
  active_agents: string;
};

type RecentSignup = {
  id: string;
  email: string;
  name: string | null;
  created_at: string | Date;
};

type RecentDeployment = {
  tenant_id: string;
  provider: "vercel" | "supabase";
  provider_user_id: string | null;
  connected_at: string | Date;
};

function formatDate(value: string | Date) {
  return new Date(value).toLocaleString();
}

export default async function AdminOverviewPage() {
  const [statsResult, signupsResult, deploymentsResult] = await Promise.all([
    pool.query<OverviewStats>(`
      SELECT
        (SELECT COUNT(*) FROM tenants)::text AS total_tenants,
        (SELECT COUNT(*) FROM tenants WHERE status = 'active')::text AS active_tenants,
        (SELECT COALESCE(SUM(margin_cents), 0) FROM usage_logs)::text AS total_revenue_cents,
        (SELECT COUNT(*) FROM tenant_channels WHERE muted = FALSE)::text AS active_agents
    `),
    pool.query<RecentSignup>(`
      SELECT id, email, name, created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 8
    `),
    pool.query<RecentDeployment>(`
      SELECT tenant_id, provider, provider_user_id, connected_at
      FROM deploy_connections
      ORDER BY connected_at DESC
      LIMIT 8
    `),
  ]);

  const stats = statsResult.rows[0];
  const cards = [
    { label: "Total Tenants", value: Number(stats.total_tenants) },
    { label: "Active Tenants", value: Number(stats.active_tenants) },
    {
      label: "Total Revenue",
      value: `$${(Number(stats.total_revenue_cents) / 100).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`,
    },
    { label: "Active Agents", value: Number(stats.active_agents) },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <article
            key={card.label}
            className="rounded-xl border border-[#1f1f30] bg-[#121220] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
          >
            <p className="text-xs uppercase tracking-wide text-gray-400">{card.label}</p>
            <p className="mt-3 text-2xl font-semibold text-gray-100">{card.value}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-[#1f1f30] bg-[#121220] p-5">
          <h2 className="text-lg font-medium text-gray-100">Recent Signups</h2>
          <div className="mt-4 space-y-3">
            {signupsResult.rows.length === 0 ? (
              <p className="text-sm text-gray-400">No signups yet.</p>
            ) : (
              signupsResult.rows.map((user) => (
                <div key={user.id} className="rounded-lg border border-[#242438] bg-[#10101a] px-3 py-2">
                  <p className="text-sm text-gray-200">{user.name || user.email}</p>
                  <p className="text-xs text-gray-400">{user.email}</p>
                  <p className="mt-1 text-xs text-gray-500">{formatDate(user.created_at)}</p>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="rounded-xl border border-[#1f1f30] bg-[#121220] p-5">
          <h2 className="text-lg font-medium text-gray-100">Recent Deployments</h2>
          <div className="mt-4 space-y-3">
            {deploymentsResult.rows.length === 0 ? (
              <p className="text-sm text-gray-400">No deployments connected yet.</p>
            ) : (
              deploymentsResult.rows.map((deploy, index) => (
                <div
                  key={`${deploy.tenant_id}-${deploy.provider}-${index}`}
                  className="rounded-lg border border-[#242438] bg-[#10101a] px-3 py-2"
                >
                  <p className="text-sm capitalize text-gray-200">{deploy.provider}</p>
                  <p className="text-xs text-gray-400">Tenant: {deploy.tenant_id}</p>
                  {deploy.provider_user_id ? (
                    <p className="text-xs text-gray-400">Account: {deploy.provider_user_id}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-gray-500">{formatDate(deploy.connected_at)}</p>
                </div>
              ))
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
