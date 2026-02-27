import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAdminApi } from "@/lib/admin";

export async function GET(
  _req: Request,
  { params }: { params: { tenantId: string } }
) {
  const auth = await requireAdminApi();
  if (!auth.ok) {
    return auth.response;
  }

  const tenantId = params.tenantId;
  const [tenantResult, usageResult, usersResult, agentsResult, deploymentsResult] = await Promise.all([
    pool.query(
      `SELECT t.id, t.status, t.created_at, u.name, u.email, COALESCE(c.balance_cents, 0) AS balance_cents
       FROM tenants t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN credits c ON c.tenant_id = t.id
       WHERE t.id = $1`,
      [tenantId]
    ),
    pool.query(
      `SELECT TO_CHAR(created_at::date, 'YYYY-MM-DD') AS day, COALESCE(SUM(cost_cents), 0)::int AS cost_cents
       FROM usage_logs
       WHERE tenant_id = $1
         AND created_at >= NOW() - INTERVAL '14 days'
       GROUP BY created_at::date
       ORDER BY created_at::date ASC`,
      [tenantId]
    ),
    pool.query(
      `SELECT u.id, u.email, u.name, u.role
       FROM users u
       JOIN tenants t ON t.user_id = u.id
       WHERE t.id = $1`,
      [tenantId]
    ),
    pool.query(
      `SELECT id, channel, channel_user_id, muted, linked_at
       FROM tenant_channels
       WHERE tenant_id = $1
       ORDER BY linked_at DESC`,
      [tenantId]
    ),
    pool.query(
      `SELECT id, provider, provider_user_id, connected_at
       FROM deploy_connections
       WHERE tenant_id = $1
       ORDER BY connected_at DESC`,
      [tenantId]
    ),
  ]);

  if (tenantResult.rows.length === 0) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  return NextResponse.json({
    tenant: tenantResult.rows[0],
    usage: usageResult.rows,
    users: usersResult.rows,
    agents: agentsResult.rows,
    deployments: deploymentsResult.rows,
  });
}
