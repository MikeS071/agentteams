import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";

export async function getAdminSession() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return null;
  }

  const adminResult = await pool.query<{ is_admin: boolean; deleted_at: string | null }>(
    "SELECT is_admin, deleted_at FROM users WHERE id = $1",
    [session.user.id]
  );

  const adminRow = adminResult.rows[0];
  if (!adminRow || !adminRow.is_admin || adminRow.deleted_at) {
    return null;
  }

  return session;
}
