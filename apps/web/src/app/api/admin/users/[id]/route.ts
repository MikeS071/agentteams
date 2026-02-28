import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import pool from "@/lib/db";
import { getAdminSession } from "@/lib/admin-auth";
import { getAdminUserDetail } from "@/lib/admin-user-detail";
import { verifyMutationOrigin } from "@/lib/security";
import { parseJSONBody, parseWithSchema } from "@/lib/validation";

type RouteContext = {
  params: { id: string };
};

export const dynamic = "force-dynamic";
const userIdParamSchema = z.object({ id: z.string().uuid() });
const adminUserActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("suspend"),
    suspended: z.boolean(),
  }),
  z.object({
    action: z.literal("changeRole"),
    role: z.enum(["user", "admin"]),
  }),
  z.object({
    action: z.literal("adjustCredits"),
    amountCents: z.number().int().refine((n) => n !== 0),
    reason: z.string().trim().min(1).max(200),
  }),
]);

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const parsedParams = parseWithSchema(params, userIdParamSchema, "Invalid user id");
  if (!parsedParams.success) {
    return parsedParams.response;
  }

  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await getAdminUserDetail(parsedParams.data.id);
    if (!data) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error("Admin user GET error", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const originError = verifyMutationOrigin(request);
  if (originError) {
    return originError;
  }

  const parsedParams = parseWithSchema(params, userIdParamSchema, "Invalid user id");
  if (!parsedParams.success) {
    return parsedParams.response;
  }
  const userId = parsedParams.data.id;

  const session = await getAdminSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsedBody = await parseJSONBody(request, adminUserActionSchema);
    if (!parsedBody.success) {
      return parsedBody.response;
    }
    const body = parsedBody.data;
    const action = body.action;

    if (action === "suspend") {
      const suspended = body.suspended;
      await pool.query(
        `UPDATE users
         SET suspended_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
             updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL`,
        [userId, suspended]
      );
      const data = await getAdminUserDetail(userId);
      if (!data) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      return NextResponse.json(data);
    }

    if (action === "changeRole") {
      const role = body.role;

      if (session.user.id === userId && role !== "admin") {
        return NextResponse.json({ error: "Cannot demote your own admin role" }, { status: 400 });
      }

      await pool.query(
        `UPDATE users
         SET is_admin = $2,
             updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL`,
        [userId, role === "admin"]
      );
      const data = await getAdminUserDetail(userId);
      if (!data) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      return NextResponse.json(data);
    }

    if (action === "adjustCredits") {
      const amountCents = body.amountCents;
      const reason = body.reason.trim();

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const tenantResult = await client.query<{ tenant_id: string | null }>(
          `SELECT t.id AS tenant_id
           FROM users u
           LEFT JOIN tenants t ON t.user_id = u.id
           WHERE u.id = $1 AND u.deleted_at IS NULL`,
          [userId]
        );

        const tenantId = tenantResult.rows[0]?.tenant_id;
        if (!tenantId) {
          await client.query("ROLLBACK");
          return NextResponse.json({ error: "User has no tenant" }, { status: 400 });
        }

        await client.query(
          `INSERT INTO credits (tenant_id, balance_cents, free_credit_used, updated_at)
           VALUES ($1, 0, false, NOW())
           ON CONFLICT (tenant_id) DO NOTHING`,
          [tenantId]
        );

        await client.query(
          `UPDATE credits
           SET balance_cents = balance_cents + $2,
               updated_at = NOW()
           WHERE tenant_id = $1`,
          [tenantId, amountCents]
        );

        await client.query(
          `INSERT INTO credit_transactions (tenant_id, amount_cents, reason, admin_user_id)
           VALUES ($1, $2, $3, $4)`,
          [tenantId, amountCents, reason, session.user.id]
        );

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      const data = await getAdminUserDetail(userId);
      if (!data) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    console.error("Admin user PATCH error", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const parsedParams = parseWithSchema(params, userIdParamSchema, "Invalid user id");
  if (!parsedParams.success) {
    return parsedParams.response;
  }
  const userId = parsedParams.data.id;

  const originError = verifyMutationOrigin(_request);
  if (originError) {
    return originError;
  }

  const session = await getAdminSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.id === userId) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `UPDATE users
       SET deleted_at = NOW(),
           suspended_at = COALESCE(suspended_at, NOW()),
           updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id`,
      [userId]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin user DELETE error", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
