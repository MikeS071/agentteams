import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { tenantId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    const tenantId = session?.user?.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (params.tenantId !== tenantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const apiBaseURL = process.env.API_URL ?? "http://localhost:8080";
    const upstream = await fetch(`${apiBaseURL}/api/deploy/status/${encodeURIComponent(tenantId)}`, {
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
    console.error("deploy status error", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
