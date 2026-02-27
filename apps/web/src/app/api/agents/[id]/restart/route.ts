import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

type Params = { params: { id: string } };

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(_req: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return unauthorized();
  }

  const apiBaseURL = process.env.API_URL ?? "http://localhost:8080";

  try {
    const upstream = await fetch(`${apiBaseURL}/api/agents/${params.id}/restart`, {
      method: "POST",
      cache: "no-store",
    });

    const payload = await upstream.json().catch(() => ({ error: "Invalid response from coordinator" }));

    if (!upstream.ok) {
      return NextResponse.json(payload, { status: upstream.status });
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("agent restart POST error", error);
    return NextResponse.json({ error: "Failed to restart agent" }, { status: 500 });
  }
}
