import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";
import { verifyMutationOrigin } from "@/lib/security";
import { getStripe } from "@/lib/stripe";
import { parseJSONBody } from "@/lib/validation";

const mutateSchema = z.object({
  paymentMethodId: z.string().trim().min(1),
});

type UserStripeRow = {
  email: string;
  stripe_customer_id: string | null;
};

async function getAuthenticatedUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return null;
  }
  return session.user;
}

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

async function getDefaultPaymentMethodId(customerId: string): Promise<string | null> {
  const stripe = getStripe();
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) {
    return null;
  }

  const defaultMethod = customer.invoice_settings?.default_payment_method;
  return typeof defaultMethod === "string" ? defaultMethod : defaultMethod?.id ?? null;
}

export async function GET() {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const customerId = await ensureStripeCustomer(user.id, user.email);
    if (!customerId) {
      return NextResponse.json({ paymentMethods: [] });
    }

    const stripe = getStripe();
    const [defaultPaymentMethodId, paymentMethods] = await Promise.all([
      getDefaultPaymentMethodId(customerId),
      stripe.paymentMethods.list({
        customer: customerId,
        type: "card",
        limit: 20,
      }),
    ]);

    return NextResponse.json({
      paymentMethods: paymentMethods.data.map((method) => ({
        id: method.id,
        brand: method.card?.brand ?? "card",
        last4: method.card?.last4 ?? "",
        expMonth: method.card?.exp_month ?? 0,
        expYear: method.card?.exp_year ?? 0,
        funding: method.card?.funding ?? "unknown",
        isDefault: method.id === defaultPaymentMethodId,
      })),
    });
  } catch (error) {
    console.error("Payment methods GET failed", error);
    return NextResponse.json({ error: "Failed to load payment methods" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const originError = verifyMutationOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = await parseJSONBody(request, mutateSchema);
    if (!parsed.success) {
      return parsed.response;
    }

    const customerId = await ensureStripeCustomer(user.id, user.email);
    if (!customerId) {
      return NextResponse.json({ error: "Stripe customer not found" }, { status: 404 });
    }

    const stripe = getStripe();
    const paymentMethod = await stripe.paymentMethods.retrieve(parsed.data.paymentMethodId);
    if (paymentMethod.customer !== customerId) {
      return NextResponse.json({ error: "Payment method does not belong to user" }, { status: 403 });
    }

    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: parsed.data.paymentMethodId,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Payment method PATCH failed", error);
    return NextResponse.json({ error: "Failed to update default payment method" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const originError = verifyMutationOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = await parseJSONBody(request, mutateSchema);
    if (!parsed.success) {
      return parsed.response;
    }

    const customerId = await ensureStripeCustomer(user.id, user.email);
    if (!customerId) {
      return NextResponse.json({ error: "Stripe customer not found" }, { status: 404 });
    }

    const stripe = getStripe();
    const paymentMethod = await stripe.paymentMethods.retrieve(parsed.data.paymentMethodId);
    if (paymentMethod.customer !== customerId) {
      return NextResponse.json({ error: "Payment method does not belong to user" }, { status: 403 });
    }

    const defaultId = await getDefaultPaymentMethodId(customerId);

    await stripe.paymentMethods.detach(parsed.data.paymentMethodId);

    if (defaultId === parsed.data.paymentMethodId) {
      const remaining = await stripe.paymentMethods.list({
        customer: customerId,
        type: "card",
        limit: 1,
      });
      await stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: remaining.data[0]?.id ?? null,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Payment method DELETE failed", error);
    return NextResponse.json({ error: "Failed to delete payment method" }, { status: 500 });
  }
}
