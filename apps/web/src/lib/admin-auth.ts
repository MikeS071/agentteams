import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function getAdminSession() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return null;
  }

  if (!session.user.isAdmin) {
    return null;
  }

  return session;
}

export type AdminAuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; error: string };

export async function requireAdmin(): Promise<AdminAuthResult> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  if (!session.user.isAdmin) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  return { ok: true, userId: session.user.id };
}
