import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkFeatureAccess } from "@/lib/feature-policies";
import { buildServiceHeaders } from "@/lib/security";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return unauthorized();
  }
  const featureAccess = await checkFeatureAccess(tenantId, "deploy");
  if (featureAccess) {
    return featureAccess;
  }

  const runID = params.id?.trim();
  if (!runID) {
    return NextResponse.json({ error: "Missing deployment id" }, { status: 400 });
  }

  const apiBaseURL = process.env.API_URL ?? "http://localhost:8080";
  const url = new URL(`${apiBaseURL}/api/deploy/status/${encodeURIComponent(runID)}`);
  url.searchParams.set("tenant_id", tenantId);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        ...buildServiceHeaders(),
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const details = await response.text();
      return NextResponse.json(
        {
          error: "Failed to fetch deployment status",
          details: details || `status ${response.status}`,
        },
        { status: response.status === 404 ? 404 : 502 }
      );
    }

    const payload = await response.json();
    return NextResponse.json(payload);
  } catch (error) {
    console.error("deploy run status GET error", error);
    return NextResponse.json({ error: "Failed to fetch deployment status" }, { status: 500 });
  }
}
