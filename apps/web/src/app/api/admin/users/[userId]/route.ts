import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAdminApi } from "@/lib/admin";

export async function GET(
  _req: Request,
  { params }: { params: { userId: string } }
) {
  const auth = await requireAdminApi();
  if (!auth.ok) {
    return auth.response;
  }

  const result = await pool.query(
    `SELECT u.id, u.email, u.name, u.role, u.created_at, u.updated_at, t.id AS tenant_id
     FROM users u
     LEFT JOIN tenants t ON t.user_id = u.id
     WHERE u.id = $1`,
    [params.userId]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json(result.rows[0]);
}
