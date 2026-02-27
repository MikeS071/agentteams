import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAdminApi } from "@/lib/admin";

const ALLOWED = new Set(["active", "paused", "suspended"]);

export async function POST(
  req: Request,
  { params }: { params: { tenantId: string } }
) {
  const auth = await requireAdminApi();
  if (!auth.ok) {
    return auth.response;
  }

  const body = (await req.json().catch(() => ({}))) as { status?: string };
  if (!body.status || !ALLOWED.has(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  await pool.query("UPDATE tenants SET status = $1 WHERE id = $2", [body.status, params.tenantId]);
  return NextResponse.json({ ok: true });
}
