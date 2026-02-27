import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAdminApi } from "@/lib/admin";

export async function POST(
  req: Request,
  { params }: { params: { tenantId: string } }
) {
  const auth = await requireAdminApi();
  if (!auth.ok) {
    return auth.response;
  }

  const body = (await req.json().catch(() => ({}))) as { deltaCents?: number };
  if (typeof body.deltaCents !== "number" || !Number.isFinite(body.deltaCents)) {
    return NextResponse.json({ error: "Invalid deltaCents" }, { status: 400 });
  }

  await pool.query(
    `INSERT INTO credits (tenant_id, balance_cents, free_credit_used, updated_at)
     VALUES ($1, $2, TRUE, NOW())
     ON CONFLICT (tenant_id)
     DO UPDATE SET
       balance_cents = GREATEST(credits.balance_cents + EXCLUDED.balance_cents, 0),
       free_credit_used = TRUE,
       updated_at = NOW()`,
    [params.tenantId, Math.trunc(body.deltaCents)]
  );

  return NextResponse.json({ ok: true });
}
