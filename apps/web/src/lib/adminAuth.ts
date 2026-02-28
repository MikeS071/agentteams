import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function requireAdminSession() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { ok: false as const, status: 401, error: "Unauthorized" };
  }

  if (!session.user.isAdmin) {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }

  return { ok: true as const, userId: session.user.id };
}
