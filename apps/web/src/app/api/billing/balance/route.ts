import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) AS balance FROM credit_ledger WHERE tenant_id = $1",
      [session.user.tenantId]
    );

    return NextResponse.json({
      balance: Number(result.rows[0]?.balance ?? 0),
    });
  } catch (error) {
    console.error("Billing balance error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
