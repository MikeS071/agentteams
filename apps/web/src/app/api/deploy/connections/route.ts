import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";
import { checkFeatureAccess } from "@/lib/feature-policies";
import { verifyMutationOrigin } from "@/lib/security";
import { parseJSONBody, parseWithSchema } from "@/lib/validation";

const DEPLOY_PROVIDERS = ["vercel", "supabase"] as const;
type DeployProvider = (typeof DEPLOY_PROVIDERS)[number];

type ConnectionRow = {
  provider: DeployProvider;
  provider_user_id: string | null;
  connected_at: string | Date;
};

export const dynamic = "force-dynamic";

async function getTenantIdFromSession(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.tenantId ?? null;
}

export async function GET() {
  try {
    const tenantId = await getTenantIdFromSession();
    if (!tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const featureAccess = await checkFeatureAccess(tenantId, "deploy");
    if (featureAccess) {
      return featureAccess;
    }

    const result = await pool.query<ConnectionRow>(
      `SELECT provider, provider_user_id, connected_at
       FROM deploy_connections
       WHERE tenant_id = $1
       ORDER BY provider ASC`,
      [tenantId]
    );

    const connections = result.rows.map((row) => ({
      provider: row.provider,
      providerUserId: row.provider_user_id,
      connectedAt:
        row.connected_at instanceof Date
          ? row.connected_at.toISOString()
          : new Date(row.connected_at).toISOString(),
    }));

    return NextResponse.json({ connections });
  } catch (error) {
    console.error("Deploy connections GET error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const originError = verifyMutationOrigin(request);
    if (originError) {
      return originError;
    }

    const tenantId = await getTenantIdFromSession();
    if (!tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const featureAccess = await checkFeatureAccess(tenantId, "deploy");
    if (featureAccess) {
      return featureAccess;
    }

    let provider = request.nextUrl.searchParams.get("provider");

    if (!provider) {
      const parsedBody = await parseJSONBody(
        request,
        z.object({
          provider: z.string(),
        })
      );
      if (parsedBody.success) {
        provider = parsedBody.data.provider;
      }
    }

    const parsedProvider = parseWithSchema(
      { provider },
      z.object({
        provider: z.enum(DEPLOY_PROVIDERS),
      }),
      "Invalid provider"
    );
    if (!parsedProvider.success) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }
    provider = parsedProvider.data.provider;

    await pool.query(
      `DELETE FROM deploy_connections
       WHERE tenant_id = $1 AND provider = $2`,
      [tenantId, provider]
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Deploy connections DELETE error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
