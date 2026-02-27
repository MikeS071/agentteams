import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAdminApi } from "@/lib/admin";

export async function POST(
  _req: Request,
  { params }: { params: { tenantId: string } }
) {
  const auth = await requireAdminApi();
  if (!auth.ok) {
    return auth.response;
  }

  const tenant = await pool.query("SELECT id FROM tenants WHERE id = $1", [params.tenantId]);
  if (tenant.rows.length === 0) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, tenantId: params.tenantId });
}
