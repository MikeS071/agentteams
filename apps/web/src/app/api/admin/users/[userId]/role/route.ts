import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAdminApi } from "@/lib/admin";

const ALLOWED = new Set(["user", "admin", "disabled"]);

export async function POST(
  req: Request,
  { params }: { params: { userId: string } }
) {
  const auth = await requireAdminApi();
  if (!auth.ok) {
    return auth.response;
  }

  const body = (await req.json().catch(() => ({}))) as { role?: string };
  if (!body.role || !ALLOWED.has(body.role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  await pool.query("UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2", [body.role, params.userId]);
  return NextResponse.json({ ok: true });
}
