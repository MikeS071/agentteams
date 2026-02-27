import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

type WorkflowStep = {
  id: string;
  type: string;
  prompt: string;
  options?: string[];
  default?: string;
  help?: string;
};

type WorkflowTemplate = {
  id: string;
  name: string;
  description: string;
  icon?: string;
  cost_hint?: string;
  steps?: WorkflowStep[];
};

type UpstreamResponse = {
  workflows?: WorkflowTemplate[];
};

function estimateDuration(costHint: string | undefined, stepCount: number): string {
  if (costHint === "low") return "5-10 min";
  if (costHint === "medium") return "10-20 min";
  if (costHint === "high") return "20-35 min";

  const min = Math.max(5, stepCount * 3);
  const max = Math.max(min + 5, stepCount * 6);
  return `${min}-${max} min`;
}

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiBaseURL = process.env.API_URL ?? "http://localhost:8080";

  try {
    const upstream = await fetch(`${apiBaseURL}/api/workflows`, {
      cache: "no-store",
    });

    if (!upstream.ok) {
      const details = await upstream.text();
      return NextResponse.json(
        { error: "Failed to load workflow templates", details: details || `status ${upstream.status}` },
        { status: 502 }
      );
    }

    const payload = (await upstream.json()) as UpstreamResponse;
    const templates = (payload.workflows ?? []).map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      icon: workflow.icon ?? "",
      costHint: workflow.cost_hint ?? "",
      stepCount: workflow.steps?.length ?? 0,
      estimatedDuration: estimateDuration(workflow.cost_hint, workflow.steps?.length ?? 0),
      steps: workflow.steps ?? [],
    }));

    return NextResponse.json({ templates });
  } catch (error) {
    console.error("Workflow templates error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
