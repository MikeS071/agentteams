import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";

export type AdminAuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; error: string };

export async function requireAdmin(): Promise<AdminAuthResult> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const result = await pool.query<{ is_admin: boolean }>(
    "SELECT is_admin FROM users WHERE id = $1",
    [userId]
  );

  if (result.rows.length === 0 || !result.rows[0].is_admin) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  return { ok: true, userId };
}
