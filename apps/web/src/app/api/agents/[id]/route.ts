import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

type Params = { params: { id: string } };

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(_req: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return unauthorized();
  }

  const apiBaseURL = process.env.API_URL ?? "http://localhost:8080";

  try {
    const upstream = await fetch(`${apiBaseURL}/api/agents/${params.id}`, { cache: "no-store" });
    const payload = await upstream.json().catch(() => ({ error: "Invalid response from coordinator" }));

    if (!upstream.ok) {
      return NextResponse.json(payload, { status: upstream.status });
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("agent detail GET error", error);
    return NextResponse.json({ error: "Failed to fetch agent detail" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return unauthorized();
  }

  const apiBaseURL = process.env.API_URL ?? "http://localhost:8080";

  try {
    const upstream = await fetch(`${apiBaseURL}/api/agents/${params.id}`, {
      method: "DELETE",
      cache: "no-store",
    });

    if (upstream.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const payload = await upstream.json().catch(() => ({ error: "Invalid response from coordinator" }));

    if (!upstream.ok) {
      return NextResponse.json(payload, { status: upstream.status });
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("agent DELETE error", error);
    return NextResponse.json({ error: "Failed to stop agent" }, { status: 500 });
  }
}
