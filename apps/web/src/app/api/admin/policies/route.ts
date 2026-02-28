import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApiSession } from "@/lib/admin";
import { FEATURES, isFeature, type Feature } from "@/lib/features";
import {
  listTenantPolicies,
  setFeaturePolicyForAllTenants,
  setTenantFeaturePolicy,
} from "@/lib/feature-policies";
import { verifyMutationOrigin } from "@/lib/security";
import { parseJSONBody, parseWithSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiSession();
  if ("response" in auth) {
    return auth.response;
  }

  const parsedQuery = parseWithSchema(
    { search: request.nextUrl.searchParams.get("search") ?? "" },
    z.object({ search: z.string().max(200) }),
    "Invalid query params"
  );
  if (!parsedQuery.success) {
    return parsedQuery.response;
  }
  const search = parsedQuery.data.search;
  const tenants = await listTenantPolicies(search);

  return NextResponse.json({
    features: FEATURES,
    tenants,
  });
}

export async function PATCH(request: NextRequest) {
  const originError = verifyMutationOrigin(request);
  if (originError) {
    return originError;
  }

  const auth = await requireAdminApiSession();
  if ("response" in auth) {
    return auth.response;
  }

  const parsedBody = await parseJSONBody(
    request,
    z.object({
      tenantId: z.string().uuid().optional(),
      feature: z.string(),
      enabled: z.boolean(),
      allTenants: z.boolean().optional(),
    })
  );
  if (!parsedBody.success) {
    return parsedBody.response;
  }
  const body = parsedBody.data;

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
