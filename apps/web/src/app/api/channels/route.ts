import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildServiceHeaders, verifyMutationOrigin } from "@/lib/security";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function apiBaseURL() {
  return (process.env.API_URL ?? "http://localhost:8080").replace(/\/$/, "");
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId?.trim();
  if (!tenantId) {
    return unauthorized();
  }

  const res = await fetch(`${apiBaseURL()}/api/channels?tenant_id=${encodeURIComponent(tenantId)}`, {
    method: "GET",
    headers: {
      ...buildServiceHeaders(),
    },
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    return NextResponse.json({ error: "Failed to load channels", details: text }, { status: 502 });
  }

  try {
    const payload = JSON.parse(text) as unknown;
    return NextResponse.json(payload, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Invalid response from channel API" }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const originError = verifyMutationOrigin(req);
  if (originError) {
    return originError;
  }

  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId?.trim();
  if (!tenantId) {
    return unauthorized();
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "Missing channel id" }, { status: 400 });
  }

  const res = await fetch(`${apiBaseURL()}/api/channels/${encodeURIComponent(id)}?tenant_id=${encodeURIComponent(tenantId)}`, {
    method: "DELETE",
    headers: {
      ...buildServiceHeaders(),
    },
    cache: "no-store",
  });

  if (res.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  const text = await res.text();
  return NextResponse.json(
    { error: "Failed to disconnect channel", details: text || `status ${res.status}` },
    { status: res.ok ? 200 : 502 }
  );
}
