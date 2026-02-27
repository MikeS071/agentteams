import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";

const DEPLOY_PROVIDERS = ["vercel", "supabase"] as const;
type DeployProvider = (typeof DEPLOY_PROVIDERS)[number];

type ConnectionRow = {
  provider: DeployProvider;
  provider_user_id: string | null;
  connected_at: string | Date;
};

export const dynamic = "force-dynamic";

function isDeployProvider(value: string | null): value is DeployProvider {
  return !!value && DEPLOY_PROVIDERS.includes(value as DeployProvider);
}

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
    const tenantId = await getTenantIdFromSession();
    if (!tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let provider = request.nextUrl.searchParams.get("provider");

    if (!provider) {
      try {
        const body = (await request.json()) as { provider?: string };
        provider = body.provider ?? null;
      } catch {
        provider = null;
      }
    }

    if (!isDeployProvider(provider)) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }

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
