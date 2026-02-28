import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildServiceHeaders } from "@/lib/security";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

const apiBaseURL = process.env.API_URL ?? "http://localhost:8080";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return unauthorized();
  }

  try {
    const res = await fetch(
      `${apiBaseURL}/api/swarm/tasks?tenant_id=${encodeURIComponent(session.user.tenantId)}`,
      {
        method: "GET",
        cache: "no-store",
        headers: {
          ...buildServiceHeaders(),
          "X-Tenant-ID": session.user.tenantId,
        },
      }
    );

    if (!res.ok) {
      const details = await res.text();
      return NextResponse.json(
        { error: "Failed to load swarm tasks", details: details || `status ${res.status}` },
        { status: 502 }
      );
    }

    const payload = await res.json();
    return NextResponse.json(payload);
  } catch (error) {
    console.error("swarm tasks GET error", error);
    return NextResponse.json({ error: "Failed to load swarm tasks" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return unauthorized();
  }

  let body: { task?: string } = {};
  try {
    body = (await req.json()) as { task?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const task = (body.task ?? "").trim();
  if (!task) {
    return NextResponse.json({ error: "Task is required" }, { status: 400 });
  }

  try {
    const res = await fetch(`${apiBaseURL}/api/swarm/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildServiceHeaders(),
        "X-Tenant-ID": session.user.tenantId,
      },
      body: JSON.stringify({
        tenant_id: session.user.tenantId,
        task,
        trigger_type: "dashboard",
      }),
    });

    const payloadText = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: "Failed to create swarm task", details: payloadText || `status ${res.status}` },
        { status: res.status === 409 ? 409 : 502 }
      );
    }

    const payload = payloadText ? JSON.parse(payloadText) : {};
    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    console.error("swarm tasks POST error", error);
    return NextResponse.json({ error: "Failed to create swarm task" }, { status: 500 });
  }
}
