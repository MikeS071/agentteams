import { getServerSession } from "next-auth";
import pool from "@/lib/db";
import { authOptions } from "@/lib/auth";

export async function requireAdminSession() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return { ok: false as const, status: 401, error: "Unauthorized" };
  }

  const result = await pool.query<{ is_admin: boolean }>(
    "SELECT is_admin FROM users WHERE id = $1",
    [userId]
  );

  if (result.rowCount === 0 || !result.rows[0].is_admin) {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }

  return { ok: true as const, userId };
}
