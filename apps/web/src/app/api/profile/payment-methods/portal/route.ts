import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";
import { verifyMutationOrigin } from "@/lib/security";
import { getStripe } from "@/lib/stripe";

type UserStripeRow = {
  email: string;
  stripe_customer_id: string | null;
};

async function ensureStripeCustomer(userId: string, email?: string | null): Promise<string | null> {
  const rowResult = await pool.query<UserStripeRow>(
    "SELECT email, stripe_customer_id FROM users WHERE id = $1 AND deleted_at IS NULL",
    [userId]
  );

  const row = rowResult.rows[0];
  if (!row) {
    return null;
  }

  if (row.stripe_customer_id) {
    return row.stripe_customer_id;
  }

  const effectiveEmail = email ?? row.email;
  if (!effectiveEmail) {
    return null;
  }

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: effectiveEmail,
    metadata: {
      userId,
    },
  });

  await pool.query(
    "UPDATE users SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2",
    [customer.id, userId]
  );

  return customer.id;
}

export async function POST(request: NextRequest) {
  const originError = verifyMutationOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const customerId = await ensureStripeCustomer(session.user.id, session.user.email);
    if (!customerId) {
      return NextResponse.json({ error: "Stripe customer not found" }, { status: 404 });
    }

    const stripe = getStripe();
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${request.nextUrl.origin}/dashboard/profile`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (error) {
    console.error("Stripe portal session create failed", error);
    return NextResponse.json({ error: "Failed to open billing portal" }, { status: 500 });
  }
}
