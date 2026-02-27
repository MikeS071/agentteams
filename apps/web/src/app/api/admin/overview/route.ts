import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAdminApi } from "@/lib/admin";

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) {
    return auth.response;
  }

  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM tenants)::int AS total_tenants,
      (SELECT COUNT(*) FROM tenants WHERE status = 'active')::int AS active_tenants,
      (SELECT COALESCE(SUM(margin_cents), 0) FROM usage_logs)::int AS total_revenue_cents,
      (SELECT COUNT(*) FROM tenant_channels WHERE muted = FALSE)::int AS active_agents
  `);

  return NextResponse.json(result.rows[0] ?? null);
}
