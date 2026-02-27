import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";

const INITIAL_CREDIT_CENTS = 1000;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const tenantId = session?.user?.tenantId;

    if (!tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await pool.query(
      "SELECT balance_cents FROM credits WHERE tenant_id = $1",
      [tenantId]
    );
    const balanceCents = result.rows[0]?.balance_cents ?? 0;
    const remainingPct =
      INITIAL_CREDIT_CENTS > 0 ? (balanceCents / INITIAL_CREDIT_CENTS) * 100 : 0;

    return NextResponse.json({
      balanceCents,
      initialCreditCents: INITIAL_CREDIT_CENTS,
      remainingPct,
    });
  } catch (error) {
    console.error("Billing balance error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
