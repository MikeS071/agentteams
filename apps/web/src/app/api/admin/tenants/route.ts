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
      t.id,
      u.name,
      u.email,
      CASE WHEN c.free_credit_used THEN 'Paid' ELSE 'Starter' END AS plan,
      COALESCE(c.balance_cents, 0) AS credit_balance_cents,
      (
        SELECT COUNT(*)
        FROM tenant_channels tc
        WHERE tc.tenant_id = t.id AND tc.muted = FALSE
      )::int AS active_agents,
      t.status,
      t.created_at
    FROM tenants t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN credits c ON c.tenant_id = t.id
    ORDER BY t.created_at DESC
  `);

  return NextResponse.json(result.rows);
}
