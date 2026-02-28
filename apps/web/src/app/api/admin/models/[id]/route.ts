import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApiSession } from "@/lib/admin";
import { proxyAdminService } from "@/lib/admin-service";
import { verifyMutationOrigin } from "@/lib/security";
import { parseJSONBody, parseWithSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const idSchema = z.object({ id: z.string().trim().min(1).max(120) });
const updateModelSchema = z.object({
  costPer1kInput: z.number().min(0),
  costPer1kOutput: z.number().min(0),
  markupPct: z.number().min(0).max(1000),
});

type ModelRecord = {
  id: string;
  name: string;
  provider: string;
  costPer1kInput: number;
  costPer1kOutput: number;
  markupPct: number;
  enabled: boolean;
};

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asModelRecord(input: unknown): ModelRecord | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const raw = input as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : "";
  const name = typeof raw.name === "string" ? raw.name : "";
  const provider = typeof raw.provider === "string" ? raw.provider : "";

  if (!id || !name || !provider) {
    return null;
  }

  return {
    id,
    name,
    provider,
    costPer1kInput: toNumber(raw.cost_per_1k_input ?? raw.costPer1kInput),
    costPer1kOutput: toNumber(raw.cost_per_1k_output ?? raw.costPer1kOutput),
    markupPct: toNumber(raw.markup_pct ?? raw.markupPct),
    enabled: Boolean(raw.enabled),
  };
}

async function handleUpdate(
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

  const parsedParams = parseWithSchema(params, idSchema, "Invalid model id");
  if (!parsedParams.success) {
    return parsedParams.response;
  }

  const parsedBody = await parseJSONBody(request, updateModelSchema);
  if (!parsedBody.success) {
    return parsedBody.response;
  }

  const modelId = encodeURIComponent(parsedParams.data.id);
  const proxied = await proxyAdminService<{ model?: unknown }>(`/api/admin/models/${modelId}`, {
    method: "PUT",
    body: JSON.stringify({
      cost_per_1k_input: parsedBody.data.costPer1kInput,
      cost_per_1k_output: parsedBody.data.costPer1kOutput,
      markup_pct: parsedBody.data.markupPct,
    }),
  });
  if (!proxied.ok) {
    return proxied.response;
  }

  const model = asModelRecord(proxied.data.model);
  if (!model) {
    return NextResponse.json({ error: "Admin API returned an invalid model" }, { status: 502 });
  }

  return NextResponse.json({ model });
}

export async function PUT(
  request: NextRequest,
  context: { params: { id: string } }
) {
  return handleUpdate(request, context);
}

export async function PATCH(
  request: NextRequest,
  context: { params: { id: string } }
) {
  return handleUpdate(request, context);
}
