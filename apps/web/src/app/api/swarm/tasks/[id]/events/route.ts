import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildServiceHeaders } from "@/lib/security";

export const runtime = "nodejs";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const params = await context.params;
  const taskId = params.id;
  if (!taskId) {
    return new Response(JSON.stringify({ error: "Missing task id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiBaseURL = process.env.API_URL ?? "http://localhost:8080";
  const upstream = await fetch(`${apiBaseURL}/api/swarm/tasks/${encodeURIComponent(taskId)}/events`, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "text/event-stream",
      ...buildServiceHeaders(),
      "X-Tenant-ID": session.user.tenantId,
    },
  });

  if (!upstream.ok || !upstream.body) {
    const details = await upstream.text();
    return new Response(JSON.stringify({ error: "Failed to open stream", details }), {
      status: upstream.status || 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
