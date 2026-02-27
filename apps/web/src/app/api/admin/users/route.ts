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
      u.id,
      u.email,
      u.name,
      t.id AS tenant_id,
      u.role,
      GREATEST(
        u.updated_at,
        COALESCE((SELECT MAX(created_at) FROM usage_logs ul WHERE ul.tenant_id = t.id), u.updated_at),
        COALESCE((SELECT MAX(created_at) FROM conversations c WHERE c.tenant_id = t.id), u.updated_at)
      ) AS last_active
    FROM users u
    LEFT JOIN tenants t ON t.user_id = u.id
    ORDER BY last_active DESC
  `);

  return NextResponse.json(result.rows);
}
