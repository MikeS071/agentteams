import { compare, hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";
import { verifyMutationOrigin } from "@/lib/security";
import { parseJSONBody } from "@/lib/validation";

const passwordSchema = z
  .object({
    currentPassword: z.string().min(8).max(72),
    newPassword: z.string().min(8).max(72),
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "New password must be different from the current password",
    path: ["newPassword"],
  });

type PasswordRow = {
  password_hash: string | null;
};

export async function POST(request: NextRequest) {
  const originError = verifyMutationOrigin(request);
  if (originError) {
    return originError;
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJSONBody(request, passwordSchema);
  if (!parsed.success) {
    return parsed.response;
  }

  const userResult = await pool.query<PasswordRow>(
    "SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL",
    [session.user.id]
  );

  const row = userResult.rows[0];
  if (!row) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  if (!row.password_hash) {
    return NextResponse.json(
      { error: "Password auth is not enabled for this account" },
      { status: 400 }
    );
  }

  const valid = await compare(parsed.data.currentPassword, row.password_hash);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
  }

  const nextHash = await hash(parsed.data.newPassword, 12);
  await pool.query(
    "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
    [nextHash, session.user.id]
  );

  return NextResponse.json({ ok: true });
}
