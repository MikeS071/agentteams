import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

type ConfirmBody = {
  decision?: "confirm" | "reject";
};

export async function POST(req: Request, { params }: { params: { runId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = params.runId?.trim();
  if (!runId) {
    return NextResponse.json({ error: "Missing run id" }, { status: 400 });
  }

  let body: ConfirmBody = {};
  try {
    body = (await req.json()) as ConfirmBody;
  } catch {
    body = {};
  }

  const apiBaseURL = process.env.API_URL ?? "http://localhost:8080";

  try {
    if (body.decision === "reject") {
      const runResponse = await fetch(`${apiBaseURL}/api/workflows/runs/${encodeURIComponent(runId)}`, {
        cache: "no-store",
      });
      const runPayload = await runResponse.json();
      return NextResponse.json(
        {
          run: runPayload.run,
          next_step: runPayload.next_step,
          rejected: true,
        },
        { status: 200 }
      );
    }

    const upstream = await fetch(`${apiBaseURL}/api/workflows/runs/${encodeURIComponent(runId)}/confirm`, {
      method: "POST",
    });

    const payload = await upstream.json();
    return NextResponse.json(payload, { status: upstream.status });
  } catch (error) {
    console.error("Workflow confirm error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
