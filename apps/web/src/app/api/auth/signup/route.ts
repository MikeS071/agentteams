import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import pool from "@/lib/db";
import { verifyMutationOrigin } from "@/lib/security";
import { parseJSONBody } from "@/lib/validation";

const signupSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(100).optional(),
});

export async function POST(req: Request) {
  try {
    const originError = verifyMutationOrigin(req);
    if (originError) {
      return originError;
    }

    const parsed = await parseJSONBody(req, signupSchema);
    if (!parsed.success) {
      return parsed.response;
    }
    const { email, password, name } = parsed.data;

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return NextResponse.json({ error: "User already exists" }, { status: 409 });
    }

    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)",
      [email, name ?? null, hash]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Signup error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
