import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import pool from "@/lib/db";
import { checkFeatureAccess } from "@/lib/feature-policies";
import { parseJSONBody } from "@/lib/validation";
import { verifyMutationOrigin } from "@/lib/security";

const providerSchema = z.enum(["vercel", "supabase"]);
type DeployProvider = z.infer<typeof providerSchema>;

type VercelUserResponse = {
  user?: {
    id?: string;
    email?: string;
    username?: string;
  };
};

type SupabaseOrg = {
  id?: string;
  name?: string;
  slug?: string;
};

type ConnectionRow = {
  provider: DeployProvider;
  provider_user_id: string | null;
  connected_at: string | Date;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function normalizeConnectedAt(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}

function extractSupabaseOrganizations(payload: unknown): SupabaseOrg[] {
  if (Array.isArray(payload)) {
    return payload as SupabaseOrg[];
  }
  if (payload && typeof payload === "object" && "organizations" in payload) {
    const organizations = (payload as { organizations?: unknown }).organizations;
    if (Array.isArray(organizations)) {
      return organizations as SupabaseOrg[];
    }
  }
  return [];
}

async function verifyToken(
  provider: DeployProvider,
  token: string
): Promise<{ providerUserId: string | null }> {
  if (provider === "vercel") {
    const response = await fetch("https://api.vercel.com/v2/user", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error("Vercel token verification failed");
    }
    const payload = (await response.json()) as VercelUserResponse;
    const providerUserId =
      payload.user?.email ?? payload.user?.username ?? payload.user?.id ?? null;
    return { providerUserId };
  }

  const response = await fetch("https://api.supabase.com/v1/organizations", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Supabase token verification failed");
  }
  const organizations = extractSupabaseOrganizations(await response.json());
  const firstOrg = organizations[0];
  const providerUserId = firstOrg?.name ?? firstOrg?.slug ?? firstOrg?.id ?? null;
  return { providerUserId };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return unauthorized();
  }
  const featureAccess = await checkFeatureAccess(tenantId, "deploy");
  if (featureAccess) {
    return featureAccess;
  }

  try {
    const result = await pool.query<ConnectionRow>(
      `SELECT provider, provider_user_id, connected_at
       FROM deploy_connections
       WHERE tenant_id = $1
       ORDER BY provider ASC`,
      [tenantId]
    );

    return NextResponse.json({
      connections: result.rows.map((row) => ({
        provider: row.provider,
        providerUserId: row.provider_user_id,
        connectedAt: normalizeConnectedAt(row.connected_at),
      })),
    });
  } catch (error) {
    console.error("deploy tokens GET error", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const originError = verifyMutationOrigin(request);
  if (originError) {
    return originError;
  }

  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return unauthorized();
  }
  const featureAccess = await checkFeatureAccess(tenantId, "deploy");
  if (featureAccess) {
    return featureAccess;
  }

  const parsed = await parseJSONBody(
    request,
    z.object({
      provider: providerSchema,
      token: z.string().trim().min(10).max(8000),
    })
  );
  if (!parsed.success) {
    return parsed.response;
  }

  const provider = parsed.data.provider;
  const token = parsed.data.token.trim();

  try {
    const verified = await verifyToken(provider, token);

    await pool.query(
      `INSERT INTO deploy_connections (
        tenant_id,
        provider,
        access_token_encrypted,
        provider_user_id,
        connected_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (tenant_id, provider)
      DO UPDATE SET
        access_token_encrypted = EXCLUDED.access_token_encrypted,
        provider_user_id = EXCLUDED.provider_user_id,
        connected_at = NOW()`,
      [tenantId, provider, encrypt(token), verified.providerUserId]
    );

    return NextResponse.json({
      provider,
      providerUserId: verified.providerUserId,
      connected: true,
    });
  } catch (error) {
    console.error("deploy tokens POST error", error);
    return NextResponse.json({ error: "Token verification failed" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const originError = verifyMutationOrigin(request);
  if (originError) {
    return originError;
  }

  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return unauthorized();
  }
  const featureAccess = await checkFeatureAccess(tenantId, "deploy");
  if (featureAccess) {
    return featureAccess;
  }

  const parsed = await parseJSONBody(
    request,
    z.object({
      provider: providerSchema,
    })
  );
  if (!parsed.success) {
    return parsed.response;
  }

  try {
    await pool.query(
      `DELETE FROM deploy_connections
       WHERE tenant_id = $1 AND provider = $2`,
      [tenantId, parsed.data.provider]
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("deploy tokens DELETE error", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
