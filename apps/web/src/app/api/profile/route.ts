import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";
import { buildServiceHeaders, verifyMutationOrigin } from "@/lib/security";
import { parseJSONBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

const DEFAULT_API_URL = "http://localhost:8080";

type ProfileRow = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  created_at: string | Date;
  has_password: boolean;
};

type ProviderRow = {
  provider: string;
};

const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  image: z.union([z.string().trim().url().max(1024), z.literal(""), z.null()]).optional(),
});

const deleteSchema = z.object({
  confirmation: z.literal("DELETE"),
});

function getApiBaseURL(): string {
  const configured = process.env.API_URL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_API_URL;
}

function normalizeDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function extractString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function extractGoProfile(payload: unknown): {
  timezone: string | null;
  avatarUrl: string | null;
  displayName: string | null;
} {
  if (!payload || typeof payload !== "object") {
    return { timezone: null, avatarUrl: null, displayName: null };
  }

  const data = payload as Record<string, unknown>;
  const profile =
    typeof data.profile === "object" && data.profile !== null
      ? (data.profile as Record<string, unknown>)
      : data;

  const timezone = extractString(profile.timezone) ?? extractString(data.timezone);
  const avatarUrl =
    extractString(profile.avatarUrl) ??
    extractString(profile.avatar_url) ??
    extractString(profile.image) ??
    extractString(data.avatarUrl);
  const displayName =
    extractString(profile.name) ?? extractString(profile.displayName) ?? extractString(data.name);

  return { timezone, avatarUrl, displayName };
}

async function fetchGoProfile(tenantId: string, userId: string) {
  const apiBaseURL = getApiBaseURL();
  const endpoints = [
    `${apiBaseURL}/api/tenants/${tenantId}/profile`,
    `${apiBaseURL}/api/tenants/${tenantId}/settings/profile`,
    `${apiBaseURL}/api/users/${userId}/profile`,
    `${apiBaseURL}/api/profile`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          ...buildServiceHeaders(),
        },
        cache: "no-store",
      });

      if (!response.ok) {
        if (response.status === 404 || response.status === 405) {
          continue;
        }
        continue;
      }

      const payload = await response.json();
      return extractGoProfile(payload);
    } catch {
      // Ignore Go API lookup failures and keep local profile data.
    }
  }

  return { timezone: null, avatarUrl: null, displayName: null };
}

async function syncGoProfile(tenantId: string, userId: string, update: { name?: string; avatarUrl?: string | null }) {
  const apiBaseURL = getApiBaseURL();
  const endpoints = [
    `${apiBaseURL}/api/tenants/${tenantId}/profile`,
    `${apiBaseURL}/api/users/${userId}/profile`,
    `${apiBaseURL}/api/profile`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...buildServiceHeaders(),
        },
        body: JSON.stringify(update),
      });
      if (response.ok) {
        break;
      }
    } catch {
      // Keep local DB as source of truth if upstream sync fails.
    }
  }
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userResult = await pool.query<ProfileRow>(
    `SELECT id, email, name, image, created_at, (password_hash IS NOT NULL) AS has_password
     FROM users
     WHERE id = $1 AND deleted_at IS NULL`,
    [session.user.id]
  );

  const user = userResult.rows[0];
  if (!user) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const providersResult = await pool.query<ProviderRow>(
    "SELECT provider FROM accounts WHERE user_id = $1",
    [session.user.id]
  );

  const providers = new Set(providersResult.rows.map((row) => row.provider));
  const goProfile = await fetchGoProfile(session.user.tenantId, session.user.id);

  return NextResponse.json({
    profile: {
      id: user.id,
      email: user.email,
      name: user.name ?? session.user.name ?? goProfile.displayName,
      image: user.image ?? session.user.image ?? goProfile.avatarUrl,
      memberSince: normalizeDate(user.created_at),
      timezone: goProfile.timezone,
      hasPassword: user.has_password,
      connectedAccounts: {
        google: providers.has("google"),
        github: providers.has("github"),
      },
    },
  });
}

export async function PATCH(request: NextRequest) {
  const originError = verifyMutationOrigin(request);
  if (originError) {
    return originError;
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJSONBody(request, updateProfileSchema);
  if (!parsed.success) {
    return parsed.response;
  }

  const name = parsed.data.name;
  const image =
    parsed.data.image === "" ? null : parsed.data.image === undefined ? undefined : parsed.data.image;

  if (name === undefined && image === undefined) {
    return NextResponse.json({ error: "No changes provided" }, { status: 400 });
  }

  const fields: string[] = ["updated_at = NOW()"];
  const values: Array<string | null> = [];
  let idx = 1;

  if (name !== undefined) {
    fields.push(`name = $${idx}`);
    values.push(name);
    idx += 1;
  }

  if (image !== undefined) {
    fields.push(`image = $${idx}`);
    values.push(image);
    idx += 1;
  }

  values.push(session.user.id);
  const updateResult = await pool.query<Pick<ProfileRow, "id" | "email" | "name" | "image" | "created_at">>(
    `UPDATE users
     SET ${fields.join(", ")}
     WHERE id = $${idx} AND deleted_at IS NULL
     RETURNING id, email, name, image, created_at`,
    values
  );

  const updated = updateResult.rows[0];
  if (!updated) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  await syncGoProfile(session.user.tenantId, session.user.id, {
    name: name ?? undefined,
    avatarUrl: image,
  });

  return NextResponse.json({
    profile: {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      image: updated.image,
      memberSince: normalizeDate(updated.created_at),
    },
  });
}

export async function DELETE(request: NextRequest) {
  const originError = verifyMutationOrigin(request);
  if (originError) {
    return originError;
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJSONBody(request, deleteSchema);
  if (!parsed.success) {
    return parsed.response;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE users
       SET deleted_at = NOW(), suspended_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [session.user.id]
    );
    await client.query(
      `UPDATE tenants
       SET status = 'suspended'
       WHERE user_id = $1`,
      [session.user.id]
    );
    await client.query("DELETE FROM accounts WHERE user_id = $1", [session.user.id]);
    await client.query("DELETE FROM sessions WHERE user_id = $1", [session.user.id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Delete account failed", error);
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  } finally {
    client.release();
  }

  return NextResponse.json({ ok: true });
}
