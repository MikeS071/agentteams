import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

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
    const res = await fetch(`${apiBaseURL}/api/tenants/${session.user.tenantId}/swarm/runs`, {
      method: "GET",
      cache: "no-store",
    });

    if (!res.ok) {
      const details = await res.text();
      return NextResponse.json(
        { error: "Failed to load swarm runs", details: details || `status ${res.status}` },
        { status: 502 }
      );
    }

    const payload = await res.json();
    return NextResponse.json(payload);
  } catch (error) {
    console.error("agents runs GET error", error);
    return NextResponse.json({ error: "Failed to load swarm runs" }, { status: 500 });
  }
}
