import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await pool.query<{ status: string }>(
    "SELECT status FROM tenants WHERE id = $1",
    [tenantId]
  );
  if (result.rows.length === 0) {
    return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  }

  return NextResponse.json({ status: result.rows[0].status });
}
