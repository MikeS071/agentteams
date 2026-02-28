import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApiSession } from "@/lib/admin";
import { proxyAdminService } from "@/lib/admin-service";
import { verifyMutationOrigin } from "@/lib/security";
import { parseWithSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const tenantIdSchema = z.object({ id: z.string().trim().min(1).max(128) });

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const originError = verifyMutationOrigin(request);
  if (originError) {
    return originError;
  }

  const auth = await requireAdminApiSession();
  if ("response" in auth) {
    return auth.response;
  }

  const parsed = parseWithSchema(params, tenantIdSchema, "Invalid tenant id");
  if (!parsed.success) {
    return parsed.response;
  }

  const tenantId = encodeURIComponent(parsed.data.id);
  const proxied = await proxyAdminService<Record<string, unknown>>(`/api/admin/tenants/${tenantId}/resume`, {
    method: "POST",
  });
  if (!proxied.ok) {
    return proxied.response;
  }

  return NextResponse.json(proxied.data);
}
