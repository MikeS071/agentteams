import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";

export async function getSessionWithRole() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return null;
  }

  const result = await pool.query<{ role: "user" | "admin" | "disabled" }>(
    "SELECT role FROM users WHERE id = $1",
    [session.user.id]
  );

  const role = result.rows[0]?.role ?? "user";
  return { session, role };
}

export async function requireAdminPage() {
  const auth = await getSessionWithRole();
  if (!auth?.session?.user?.id) {
    redirect("/login");
  }
  if (auth.role !== "admin") {
    redirect("/dashboard");
  }
  return auth.session;
}

export async function requireAdminApi() {
  const auth = await getSessionWithRole();
  if (!auth?.session?.user?.id) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (auth.role !== "admin") {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return {
    ok: true as const,
    session: auth.session,
  };
}
