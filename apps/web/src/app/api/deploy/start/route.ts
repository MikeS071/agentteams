import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    const tenantId = session?.user?.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: { customDomain?: string } = {};
    try {
      body = (await request.json()) as { customDomain?: string };
    } catch {
      body = {};
    }

    const providers = await pool.query<{ provider: string }>(
      `SELECT provider FROM deploy_connections WHERE tenant_id = $1 AND provider IN ('vercel', 'supabase')`,
      [tenantId]
    );

    const connected = new Set(providers.rows.map((row) => row.provider));
    if (!connected.has("vercel") || !connected.has("supabase")) {
      return NextResponse.json(
        { error: "Connect both Vercel and Supabase before deploying" },
        { status: 400 }
      );
    }

    const apiBaseURL = process.env.API_URL ?? "http://localhost:8080";
    const upstream = await fetch(`${apiBaseURL}/api/deploy/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        custom_domain: body.customDomain?.trim() || undefined,
      }),
      cache: "no-store",
    });

    const text = await upstream.text();
    let payload: unknown = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: text || "Failed to parse API response" };
    }

    return NextResponse.json(payload, { status: upstream.status });
  } catch (error) {
    console.error("deploy start error", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
