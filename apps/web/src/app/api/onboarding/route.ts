import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";
import { parseJSONBody } from "@/lib/validation";
import { verifyMutationOrigin } from "@/lib/security";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return unauthorized();
  }

  const result = await pool.query<{ onboarding_completed_at: string | null }>(
    "SELECT onboarding_completed_at FROM users WHERE id = $1",
    [session.user.id]
  );

  return NextResponse.json({
    onboardingCompleted: Boolean(result.rows[0]?.onboarding_completed_at),
  });
}

export async function POST(req: Request) {
  const originError = verifyMutationOrigin(req);
  if (originError) {
    return originError;
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return unauthorized();
  }

  const parsed = await parseJSONBody(
    req,
    z.object({
      completed: z.boolean(),
    })
  );
  if (!parsed.success) {
    return parsed.response;
  }

  if (parsed.data.completed) {
    await pool.query(
      "UPDATE users SET onboarding_completed_at = COALESCE(onboarding_completed_at, NOW()), updated_at = NOW() WHERE id = $1",
      [session.user.id]
    );

    const response = NextResponse.json({ ok: true, onboardingCompleted: true });
    response.cookies.set("onboarding_complete", "1", {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  }

  await pool.query(
    "UPDATE users SET onboarding_completed_at = NULL, updated_at = NOW() WHERE id = $1",
    [session.user.id]
  );
  const response = NextResponse.json({ ok: true, onboardingCompleted: false });
  response.cookies.set("onboarding_complete", "0", {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    maxAge: 0,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
