import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApiSession } from "@/lib/admin";
import { proxyAdminService } from "@/lib/admin-service";
import { verifyMutationOrigin } from "@/lib/security";
import { parseJSONBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

type ModelRecord = {
  id: string;
  name: string;
  provider: string;
  costPer1kInput: number;
  costPer1kOutput: number;
  markupPct: number;
  enabled: boolean;
};

const createModelSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(120),
  provider: z.string().trim().min(1).max(60),
  costPer1kInput: z.number().min(0),
  costPer1kOutput: z.number().min(0),
  markupPct: z.number().min(0).max(1000),
  enabled: z.boolean().optional(),
});

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

function createModelId(name: string, provider: string): string {
  const safe = `${provider}-${name}`
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `${safe || "model"}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function GET() {
  const auth = await requireAdminApiSession();
  if ("response" in auth) {
    return auth.response;
  }

  const proxied = await proxyAdminService<{ models?: unknown[] }>("/api/admin/models");
  if (!proxied.ok) {
    return proxied.response;
  }

  const rows = Array.isArray(proxied.data.models) ? proxied.data.models : [];
  const models = rows
    .map(asModelRecord)
    .filter((row): row is ModelRecord => row !== null);

  return NextResponse.json({ models });
}

export async function POST(request: NextRequest) {
  const originError = verifyMutationOrigin(request);
  if (originError) {
    return originError;
  }

  const auth = await requireAdminApiSession();
  if ("response" in auth) {
    return auth.response;
  }

  const parsed = await parseJSONBody(request, createModelSchema);
  if (!parsed.success) {
    return parsed.response;
  }

  const input = parsed.data;
  const modelId = input.id?.trim() || createModelId(input.name, input.provider);

  const proxied = await proxyAdminService<{ model?: unknown }>("/api/admin/models", {
    method: "POST",
    body: JSON.stringify({
      id: modelId,
      name: input.name,
      provider: input.provider,
      cost_per_1k_input: input.costPer1kInput,
      cost_per_1k_output: input.costPer1kOutput,
      markup_pct: input.markupPct,
      enabled: input.enabled,
    }),
  });
  if (!proxied.ok) {
    return proxied.response;
  }

  const model = asModelRecord(proxied.data.model);
  if (!model) {
    return NextResponse.json({ error: "Admin API returned an invalid model" }, { status: 502 });
  }

  return NextResponse.json({ model }, { status: 201 });
}
