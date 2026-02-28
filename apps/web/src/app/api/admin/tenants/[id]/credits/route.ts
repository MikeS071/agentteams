import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApiSession } from "@/lib/admin";
import { proxyAdminService } from "@/lib/admin-service";
import { verifyMutationOrigin } from "@/lib/security";
import { parseJSONBody, parseWithSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const tenantIdSchema = z.object({ id: z.string().trim().min(1).max(128) });

const adjustCreditsSchema = z.object({
  amountCents: z.number().int().optional(),
  amount: z.number().int().optional(),
  reason: z.string().trim().min(1).max(200),
});

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

  const parsedId = parseWithSchema(params, tenantIdSchema, "Invalid tenant id");
  if (!parsedId.success) {
    return parsedId.response;
  }

  const parsedBody = await parseJSONBody(request, adjustCreditsSchema);
  if (!parsedBody.success) {
    return parsedBody.response;
  }

  const amount = parsedBody.data.amountCents ?? parsedBody.data.amount;
  if (!Number.isInteger(amount) || amount === 0) {
    return NextResponse.json({ error: "amountCents must be a non-zero integer" }, { status: 400 });
  }

  const tenantId = encodeURIComponent(parsedId.data.id);
  const proxied = await proxyAdminService<Record<string, unknown>>(`/api/admin/tenants/${tenantId}/credits`, {
    method: "POST",
    body: JSON.stringify({
      amount,
      reason: parsedBody.data.reason,
    }),
  });

  if (!proxied.ok) {
    return proxied.response;
  }

  return NextResponse.json(proxied.data);
}
