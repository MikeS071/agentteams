import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAdminSession } from "@/lib/admin-auth";
import { getAdminUserDetail } from "@/lib/admin-user-detail";

type RouteContext = {
  params: { id: string };
};

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await getAdminUserDetail(params.id);
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
  const session = await getAdminSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const action = body?.action;

    if (action === "suspend") {
      const suspended = Boolean(body?.suspended);
      await pool.query(
        `UPDATE users
         SET suspended_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
             updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL`,
        [params.id, suspended]
      );
      const data = await getAdminUserDetail(params.id);
      if (!data) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      return NextResponse.json(data);
    }

    if (action === "changeRole") {
      const role = body?.role;
      if (role !== "user" && role !== "admin") {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      }

      if (session.user.id === params.id && role !== "admin") {
        return NextResponse.json({ error: "Cannot demote your own admin role" }, { status: 400 });
      }

      await pool.query(
        `UPDATE users
         SET is_admin = $2,
             updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL`,
        [params.id, role === "admin"]
      );
      const data = await getAdminUserDetail(params.id);
      if (!data) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      return NextResponse.json(data);
    }

    if (action === "adjustCredits") {
      const amountCents = Number(body?.amountCents);
      const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

      if (!Number.isInteger(amountCents) || amountCents === 0) {
        return NextResponse.json({ error: "amountCents must be a non-zero integer" }, { status: 400 });
      }
      if (!reason) {
        return NextResponse.json({ error: "Reason is required" }, { status: 400 });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const tenantResult = await client.query<{ tenant_id: string | null }>(
          `SELECT t.id AS tenant_id
           FROM users u
           LEFT JOIN tenants t ON t.user_id = u.id
           WHERE u.id = $1 AND u.deleted_at IS NULL`,
          [params.id]
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

      const data = await getAdminUserDetail(params.id);
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
  const session = await getAdminSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.id === params.id) {
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
      [params.id]
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
