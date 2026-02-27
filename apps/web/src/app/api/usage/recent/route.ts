import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";

type RecentUsageRow = {
  created_at: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_cents: number;
};
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const tenantId = session?.user?.tenantId;

    if (!tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await pool.query<RecentUsageRow>(
      `SELECT
         u.created_at,
         COALESCE(m.name, u.model) AS model,
         u.input_tokens,
         u.output_tokens,
         u.cost_cents
       FROM usage_logs u
       LEFT JOIN models m ON m.id = u.model
       WHERE u.tenant_id = $1
       ORDER BY u.created_at DESC
       LIMIT 50`,
      [tenantId]
    );

    const data = result.rows.map((row) => ({
      date: row.created_at,
      model: row.model,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cost: row.cost_cents / 100,
    }));

    return NextResponse.json(data);
  } catch (error) {
    console.error("Recent usage error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
