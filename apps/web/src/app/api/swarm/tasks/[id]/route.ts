import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildServiceHeaders } from "@/lib/security";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return unauthorized();
  }

  const params = await context.params;
  const taskId = params.id;
  if (!taskId) {
    return NextResponse.json({ error: "Missing task id" }, { status: 400 });
  }

  const apiBaseURL = process.env.API_URL ?? "http://localhost:8080";

  try {
    const res = await fetch(`${apiBaseURL}/api/swarm/tasks/${encodeURIComponent(taskId)}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        ...buildServiceHeaders(),
        "X-Tenant-ID": session.user.tenantId,
      },
    });

    const payloadText = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: "Failed to load swarm task", details: payloadText || `status ${res.status}` },
        { status: res.status === 404 ? 404 : 502 }
      );
    }

    const payload = payloadText ? JSON.parse(payloadText) : {};
    return NextResponse.json(payload);
  } catch (error) {
    console.error("swarm task GET error", error);
    return NextResponse.json({ error: "Failed to load swarm task" }, { status: 500 });
  }
}
