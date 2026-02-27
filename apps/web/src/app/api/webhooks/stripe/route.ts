import { NextResponse } from "next/server";
import pool from "@/lib/db";

type StripeCheckoutSession = {
  amount_total?: number | null;
  metadata?: Record<string, string | undefined> | null;
};

type StripeEvent = {
  type?: string;
  data?: {
    object?: StripeCheckoutSession;
  };
};

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let event: StripeEvent;
  try {
    event = (await req.json()) as StripeEvent;
  } catch {
    return NextResponse.json({ error: "invalid webhook payload" }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true });
  }

  const session = event.data?.object;
  const metadata = session?.metadata ?? {};
  const tenantId = metadata.tenantId ?? metadata.tenant_id;
  if (!tenantId) {
    return NextResponse.json({ error: "missing tenant id in metadata" }, { status: 400 });
  }

  const metadataCredits = Number(metadata.creditCents ?? metadata.credit_cents ?? "");
  const creditsToAdd =
    Number.isFinite(metadataCredits) && metadataCredits > 0
      ? Math.floor(metadataCredits)
      : Math.max(0, session?.amount_total ?? 0);
  if (creditsToAdd <= 0) {
    return NextResponse.json({ error: "missing credit amount" }, { status: 400 });
  }

  await pool.query(
    `INSERT INTO credits (tenant_id, balance_cents, free_credit_used, updated_at)
     VALUES ($1, $2, false, NOW())
     ON CONFLICT (tenant_id)
     DO UPDATE SET balance_cents = credits.balance_cents + EXCLUDED.balance_cents, updated_at = NOW()`,
    [tenantId, creditsToAdd]
  );

  const apiBaseURL = process.env.API_URL ?? "http://localhost:8080";
  const resumeResponse = await fetch(`${apiBaseURL}/api/tenants/${tenantId}/resume`, {
    method: "POST",
  });

  return NextResponse.json({
    received: true,
    tenantId,
    credited_cents: creditsToAdd,
    resume_status: resumeResponse.status,
  });
}
