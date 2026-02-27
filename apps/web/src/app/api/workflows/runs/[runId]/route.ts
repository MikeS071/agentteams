import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { runId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = params.runId?.trim();
  if (!runId) {
    return NextResponse.json({ error: "Missing run id" }, { status: 400 });
  }

  const apiBaseURL = process.env.API_URL ?? "http://localhost:8080";

  try {
    const upstream = await fetch(`${apiBaseURL}/api/workflows/runs/${encodeURIComponent(runId)}`, {
      cache: "no-store",
    });

    const payload = await upstream.json();
    return NextResponse.json(payload, { status: upstream.status });
  } catch (error) {
    console.error("Workflow run fetch error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
