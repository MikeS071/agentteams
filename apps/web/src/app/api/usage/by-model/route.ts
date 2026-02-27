import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";

type ByModelRow = {
  model: string;
  total_cost_cents: string | number;
  total_tokens: string | number;
};
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const tenantId = session?.user?.tenantId;

    if (!tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await pool.query<ByModelRow>(
      `SELECT
         COALESCE(m.name, u.model) AS model,
         COALESCE(SUM(u.cost_cents), 0) AS total_cost_cents,
         COALESCE(SUM(u.input_tokens + u.output_tokens), 0) AS total_tokens
       FROM usage_logs u
       LEFT JOIN models m ON m.id = u.model
       WHERE u.tenant_id = $1
       GROUP BY COALESCE(m.name, u.model)
       ORDER BY total_cost_cents DESC`,
      [tenantId]
    );

    const data = result.rows.map((row) => ({
      model: row.model,
      totalCost: Number(row.total_cost_cents) / 100,
      totalTokens: Number(row.total_tokens),
    }));

    return NextResponse.json(data);
  } catch (error) {
    console.error("Usage by model error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
