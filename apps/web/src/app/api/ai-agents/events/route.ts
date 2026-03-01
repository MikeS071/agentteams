import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildServiceHeaders } from "@/lib/security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return unauthorized();
  }

  const apiBaseURL = process.env.API_URL ?? "http://localhost:8080";

  try {
    const upstream = await fetch(
      `${apiBaseURL}/api/ai-agents/events?tenant_id=${encodeURIComponent(session.user.tenantId)}`,
      {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "text/event-stream",
          ...buildServiceHeaders(),
        },
      }
    );

    const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
    if (!upstream.ok || !upstream.body || !contentType.includes("text/event-stream")) {
      const details = await upstream.text();
      return NextResponse.json(
        { error: "Failed to open AI agents event stream", details: details || `status ${upstream.status}` },
        { status: 502 }
      );
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("AI agents events GET error", error);
    return NextResponse.json({ error: "Failed to open AI agents event stream" }, { status: 500 });
  }
}
