import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

type StepBody = {
  input?: string;
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

  let body: StepBody;
  try {
    body = (await req.json()) as StepBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const input = body.input?.trim() ?? "";

  const apiBaseURL = process.env.API_URL ?? "http://localhost:8080";

  try {
    const upstream = await fetch(`${apiBaseURL}/api/workflows/runs/${encodeURIComponent(runId)}/step`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input }),
    });

    const payload = await upstream.json();
    return NextResponse.json(payload, { status: upstream.status });
  } catch (error) {
    console.error("Workflow step error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
