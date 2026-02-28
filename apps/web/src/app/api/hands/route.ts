import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildServiceHeaders } from "@/lib/security";

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
    const response = await fetch(`${apiBaseURL}/api/hands`, {
      method: "GET",
      cache: "no-store",
      headers: {
        "X-Tenant-ID": session.user.tenantId,
        ...buildServiceHeaders(),
      },
    });

    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch (error) {
    console.error("hands GET error", error);
    return NextResponse.json({ error: "Failed to load hands" }, { status: 500 });
  }
}
