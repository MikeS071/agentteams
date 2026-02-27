import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";
import { getStripe } from "@/lib/stripe";

const ALLOWED_AMOUNTS = new Set([10, 25, 50, 100]);
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session.user.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const amount = Number(body?.amount);
    if (!ALLOWED_AMOUNTS.has(amount)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const stripe = getStripe();
    const userRes = await pool.query(
      "SELECT stripe_customer_id FROM users WHERE id = $1",
      [session.user.id]
    );
    let stripeCustomerId: string | null = userRes.rows[0]?.stripe_customer_id ?? null;

    if (!stripeCustomerId) {
      if (!session.user.email) {
        return NextResponse.json(
          { error: "User email is required for billing" },
          { status: 400 }
        );
      }

      const customer = await stripe.customers.create({
        email: session.user.email,
        metadata: { tenantId: session.user.tenantId },
      });
      stripeCustomerId = customer.id;

      await pool.query(
        "UPDATE users SET stripe_customer_id = $1 WHERE id = $2",
        [stripeCustomerId, session.user.id]
      );
    }

    const origin = request.headers.get("origin") ?? process.env.NEXTAUTH_URL;
    if (!origin) {
      return NextResponse.json(
        { error: "Unable to resolve app origin" },
        { status: 500 }
      );
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: stripeCustomerId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amount * 100,
            product_data: {
              name: `AgentTeams Credits ($${amount})`,
            },
          },
        },
      ],
      metadata: {
        tenantId: session.user.tenantId,
        amount: String(amount),
      },
      success_url: `${origin}/dashboard/billing?status=success`,
      cancel_url: `${origin}/dashboard/billing?status=cancelled`,
    });

    if (!checkoutSession.url) {
      return NextResponse.json(
        { error: "Failed to create checkout session" },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error) {
    console.error("Billing checkout error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
