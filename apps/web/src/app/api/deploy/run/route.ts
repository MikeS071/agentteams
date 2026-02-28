import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { checkFeatureAccess } from "@/lib/feature-policies";
import { buildServiceHeaders, verifyMutationOrigin } from "@/lib/security";
import { parseJSONBody } from "@/lib/validation";

const targetSchema = z.enum(["vercel", "supabase", "both"]);

const deployRequestSchema = z.object({
  projectName: z.string().trim().min(1).max(100),
  repoUrl: z.string().trim().url().optional().or(z.literal("")),
  branch: z.string().trim().min(1).max(128).optional(),
  target: targetSchema,
  vercel: z
    .object({
      teamId: z.string().trim().optional(),
      framework: z.string().trim().optional(),
      rootDirectory: z.string().trim().optional(),
    })
    .optional(),
  supabase: z
    .object({
      orgId: z.string().trim().min(1),
      region: z.string().trim().optional(),
      dbPassword: z.string().trim().min(8),
      migrations: z.array(z.string().trim().min(1)).optional(),
    })
    .optional(),
});

type StartRunResponse = {
  id: string;
  provider: "vercel" | "supabase";
  status: string;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

async function startProviderRun(
  endpoint: string,
  payload: unknown
): Promise<StartRunResponse> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildServiceHeaders(),
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(details || `status ${response.status}`);
  }

  return (await response.json()) as StartRunResponse;
}

export async function POST(request: Request) {
  const originError = verifyMutationOrigin(request);
  if (originError) {
    return originError;
  }

  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return unauthorized();
  }
  const featureAccess = await checkFeatureAccess(tenantId, "deploy");
  if (featureAccess) {
    return featureAccess;
  }

  const parsed = await parseJSONBody(request, deployRequestSchema);
  if (!parsed.success) {
    return parsed.response;
  }
  const body = parsed.data;

  if ((body.target === "supabase" || body.target === "both") && !body.supabase) {
    return NextResponse.json(
      { error: "Supabase settings are required for this target" },
      { status: 400 }
    );
  }

  const apiBaseURL = process.env.API_URL ?? "http://localhost:8080";
  const runRequests: Promise<StartRunResponse>[] = [];

  if (body.target === "vercel" || body.target === "both") {
    runRequests.push(
      startProviderRun(`${apiBaseURL}/api/deploy/vercel`, {
        tenant_id: tenantId,
        project_name: body.projectName,
        repo_url: body.repoUrl || "",
        branch: body.branch || "main",
        team_id: body.vercel?.teamId || "",
        framework: body.vercel?.framework || "",
        root_directory: body.vercel?.rootDirectory || "",
      })
    );
  }

  if (body.target === "supabase" || body.target === "both") {
    runRequests.push(
      startProviderRun(`${apiBaseURL}/api/deploy/supabase`, {
        tenant_id: tenantId,
        project_name: body.projectName,
        org_id: body.supabase?.orgId,
        region: body.supabase?.region || "",
        db_password: body.supabase?.dbPassword,
        migrations: body.supabase?.migrations ?? [],
      })
    );
  }

  try {
    const runs = await Promise.all(runRequests);
    return NextResponse.json({ runs });
  } catch (error) {
    console.error("deploy run POST error", error);
    return NextResponse.json(
      {
        error: "Failed to start deployment",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 }
    );
  }
}
