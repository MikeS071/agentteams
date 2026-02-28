import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/admin";
import { FEATURES, isFeature, type Feature } from "@/lib/features";
import {
  listTenantPolicies,
  setFeaturePolicyForAllTenants,
  setTenantFeaturePolicy,
} from "@/lib/feature-policies";

type PatchBody = {
  tenantId?: string;
  feature?: string;
  enabled?: boolean;
  allTenants?: boolean;
};

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiSession();
  if ("response" in auth) {
    return auth.response;
  }

  const search = request.nextUrl.searchParams.get("search") ?? "";
  const tenants = await listTenantPolicies(search);

  return NextResponse.json({
    features: FEATURES,
    tenants,
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminApiSession();
  if ("response" in auth) {
    return auth.response;
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawFeature = body.feature;
  if (!rawFeature || !isFeature(rawFeature)) {
    return NextResponse.json({ error: "Invalid feature" }, { status: 400 });
  }
  const feature: Feature = rawFeature;

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be boolean" }, { status: 400 });
  }

  if (body.allTenants) {
    await setFeaturePolicyForAllTenants(feature, body.enabled);
  } else {
    const tenantId = body.tenantId?.trim();
    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
    }
    await setTenantFeaturePolicy(tenantId, feature, body.enabled);
  }

  return NextResponse.json({ ok: true });
}
