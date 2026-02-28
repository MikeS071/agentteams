import { NextResponse } from "next/server";
import Stripe from "stripe";
import { z } from "zod";
import pool from "@/lib/db";
import { buildServiceHeaders } from "@/lib/security";
import { getStripe } from "@/lib/stripe";

const stripeEventSchema = z.object({
  type: z.string(),
  data: z.object({
    object: z
      .object({
        amount_total: z.number().int().nonnegative().nullable().optional(),
        metadata: z.record(z.string(), z.string().optional()).nullable().optional(),
      })
      .passthrough(),
  }),
});

export const dynamic = "force-dynamic";

function parseStripeEvent(body: string, signature: string | null): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET");
  }
  if (!signature) {
    throw new Error("Missing Stripe signature header");
  }

  const stripe = getStripe();
  return stripe.webhooks.constructEvent(body, signature, webhookSecret);
}

export async function POST(req: Request) {
  let event: Stripe.Event;
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("stripe-signature");
    event = parseStripeEvent(rawBody, signature);
  } catch (error) {
    console.error("Stripe webhook verification failed", error);
    return NextResponse.json({ error: "invalid webhook signature" }, { status: 400 });
  }

  const parsedEvent = stripeEventSchema.safeParse(event);
  if (!parsedEvent.success) {
    return NextResponse.json({ error: "invalid webhook payload" }, { status: 400 });
  }

  if (parsedEvent.data.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true });
  }

  const session = parsedEvent.data.data.object;
  const metadata = session.metadata ?? {};
  const tenantId = metadata.tenantId ?? metadata.tenant_id;
  if (!tenantId) {
    return NextResponse.json({ error: "missing tenant id in metadata" }, { status: 400 });
  }

  const metadataCredits = Number(metadata.creditCents ?? metadata.credit_cents ?? "");
  const creditsToAdd =
    Number.isFinite(metadataCredits) && metadataCredits > 0
      ? Math.floor(metadataCredits)
      : Math.max(0, session.amount_total ?? 0);
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
    headers: {
      ...buildServiceHeaders(),
    },
  });

  return NextResponse.json({
    received: true,
    tenantId,
    credited_cents: creditsToAdd,
    resume_status: resumeResponse.status,
  });
}
