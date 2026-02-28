import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ensureStripeCustomer,
  normalizeEmail,
  provisionTenantContainer,
} from "@/lib/auth-provisioning";
import pool from "@/lib/db";
import { verifyMutationOrigin } from "@/lib/security";
import { parseJSONBody } from "@/lib/validation";

type InsertedUserRow = { id: string };
type InsertedTenantRow = { id: string };

const signupSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(72),
});

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

export async function POST(req: Request) {
  const originError = verifyMutationOrigin(req);
  if (originError) {
    return originError;
  }

  const parsed = await parseJSONBody(req, signupSchema);
  if (!parsed.success) {
    return parsed.response;
  }

  const email = normalizeEmail(parsed.data.email);
  const passwordHash = await hash(parsed.data.password, 12);

  const client = await pool.connect();
  let userId = "";
  let tenantId = "";

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "An account with that email already exists" },
        { status: 409 }
      );
    }

    const insertedUser = await client.query<InsertedUserRow>(
      `INSERT INTO users (email, password_hash, email_verified)
       VALUES ($1, $2, NOW())
       RETURNING id`,
      [email, passwordHash]
    );
    userId = insertedUser.rows[0].id;

    const insertedTenant = await client.query<InsertedTenantRow>(
      `INSERT INTO tenants (user_id, status)
       VALUES ($1, 'active')
       RETURNING id`,
      [userId]
    );
    tenantId = insertedTenant.rows[0].id;

    await client.query(
      `INSERT INTO credits (tenant_id, balance_cents, free_credit_used)
       VALUES ($1, 1000, false)`,
      [tenantId]
    );

    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback failure and return original error handling below.
    }

    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: "An account with that email already exists" },
        { status: 409 }
      );
    }

    console.error("Signup failed:", error);
    return NextResponse.json({ error: "Signup failed" }, { status: 500 });
  } finally {
    client.release();
  }

  const setupTasks = await Promise.allSettled([
    ensureStripeCustomer(userId, email),
    provisionTenantContainer(tenantId),
  ]);

  for (const task of setupTasks) {
    if (task.status === "rejected") {
      console.error("Post-signup setup task failed:", task.reason);
    }
  }

  return NextResponse.json({ ok: true });
}
