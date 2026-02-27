import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAdminApi } from "@/lib/admin";

export async function POST(
  req: Request,
  { params }: { params: { userId: string } }
) {
  const auth = await requireAdminApi();
  if (!auth.ok) {
    return auth.response;
  }

  const body = (await req.json().catch(() => ({}))) as { disabled?: boolean };
  const role = body.disabled ? "disabled" : "user";

  await pool.query("UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2", [role, params.userId]);
  return NextResponse.json({ ok: true });
}
