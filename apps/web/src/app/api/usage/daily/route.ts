import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";

type DailyUsageRow = {
  date: string;
  input_tokens: string | number;
  output_tokens: string | number;
  cost_cents: string | number;
};
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const tenantId = session?.user?.tenantId;

    if (!tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await pool.query<DailyUsageRow>(
      `SELECT
         DATE(created_at)::text AS date,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cost_cents), 0) AS cost_cents
       FROM usage_logs
       WHERE tenant_id = $1
         AND created_at > NOW() - INTERVAL '30 days'
       GROUP BY DATE(created_at)
       ORDER BY DATE(created_at)`,
      [tenantId]
    );

    const data = result.rows.map((row) => ({
      date: row.date,
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      cost: Number(row.cost_cents) / 100,
    }));

    return NextResponse.json(data);
  } catch (error) {
    console.error("Daily usage error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
