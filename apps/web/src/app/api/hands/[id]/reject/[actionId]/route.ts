import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildServiceHeaders, verifyMutationOrigin } from "@/lib/security";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: Request, { params }: { params: { id: string; actionId: string } }) {
  const originError = verifyMutationOrigin(request);
  if (originError) {
    return originError;
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return unauthorized();
  }

  const handId = params.id?.trim();
  const actionId = params.actionId?.trim();
  if (!handId || !actionId) {
    return NextResponse.json({ error: "Missing hand id or action id" }, { status: 400 });
  }

  const apiBaseURL = process.env.API_URL ?? "http://localhost:8080";

  try {
    const upstream = await fetch(`${apiBaseURL}/api/hands/${encodeURIComponent(handId)}/reject/${encodeURIComponent(actionId)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-ID": session.user.tenantId,
        ...buildServiceHeaders(),
      },
      body: "{}",
    });

    const contentType = upstream.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const payload = await upstream.json();
      return NextResponse.json(payload, { status: upstream.status });
    }

    const text = await upstream.text();
    return NextResponse.json(
      text ? { message: text } : { status: upstream.ok ? "ok" : "error" },
      { status: upstream.status }
    );
  } catch (error) {
    console.error("hands reject POST error", error);
    return NextResponse.json({ error: "Failed to reject action" }, { status: 500 });
  }
}
